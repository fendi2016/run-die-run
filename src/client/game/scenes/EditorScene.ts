import { Scene } from 'phaser';
import { showToast } from '@devvit/web/client';
import type * as Phaser from 'phaser';
import BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import {
  EDITOR_MAX_COLUMNS,
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
} from '../../../shared/constants';
import {
  isPublishLevelResponse,
  isValidateLevelResponse,
  type DraftObject,
  type ValidateLevelRequest,
} from '../../../shared/editorApi';
import type { LevelVersion } from '../../../shared/types';
import { EditorToolbar } from '../../ui/EditorToolbar';
import { EditorController } from '../editor/EditorController';
import {
  boardGridConfig,
  drawGrid,
  normalizeBoardRow,
  EDITOR_BOARD_ROWS,
  type EditorTool,
} from '../editor/GridSystem';
import { PanZoomCamera, PAN_STEP_PX } from '../editor/PanZoomCamera';
import {
  motionTweenConfigFor,
  renderLevelObject,
  renderSpawnMarker,
} from '../objects/ObjectRegistry';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

type EditorSceneData = {
  objects?: DraftObject[];
  verifiedCandidateToken?: string;
};

const DEFAULT_SPAWN = { x: GRID_CELL_SIZE * 1.5, y: GROUND_TOP_Y };

// The mobile-first base level editor (spec section 12): tap-only
// place/select/move/delete/undo/redo over a grid, plus Test (spec section
// 13's "creator must personally beat it" gate) and Publish.
//
// Tile<->world coordinate math and tap-vs-drag gesture detection are
// delegated to rexBoard (phaser4-rex-plugins), a maintained third-party
// board/grid plugin, rather than hand-rolled pointer-threshold heuristics —
// that combination was the actual source of "can't be placed there" firing
// on ordinary taps. EditorController still owns the DraftObject list and
// undo/redo history (nothing off-the-shelf knows about this game's level
// format or its server-side verify/publish flow), and ObjectRegistry still
// owns rendering.
export class EditorScene extends Scene {
  private rexBoard!: BoardPlugin;
  private board!: BoardPlugin.Board;

  private controller!: EditorController;
  private toolbar!: EditorToolbar;
  private currentTool: EditorTool = 'select';
  private testRequest: AbortController | undefined;
  private verified = false;
  private verifiedToken: string | undefined;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private renderedObjects = new Map<string, Phaser.GameObjects.Sprite>();
  // A patrolling/rideable placed object's tween (see ObjectRegistry's
  // motionTweenConfigFor) — stopped and rebuilt alongside its sprite on
  // every redrawObjects() so a moving hazard's motion in the editor matches
  // what it'll actually do in a run, instead of sitting frozen. Stopping
  // these before destroying their sprites (rather than leaving them to keep
  // running with repeat: -1 against a dead target) is what actually matters
  // here — an uncapped pile of ghost tweens would otherwise build up on
  // every edit.
  private motionTweens: Phaser.Tweens.Tween[] = [];

  private panZoom!: PanZoomCamera;

  constructor() {
    super('EditorScene');
  }

  init(data: EditorSceneData): void {
    const defaultObjects: DraftObject[] = [
      {
        id: 'spawn-default',
        type: 'spawn',
        x: DEFAULT_SPAWN.x,
        y: DEFAULT_SPAWN.y,
      },
    ];
    this.controller = new EditorController(data.objects ?? defaultObjects);
    this.verified = data.verifiedCandidateToken !== undefined;
    this.verifiedToken = data.verifiedCandidateToken;
    this.currentTool = 'select';
    this.renderedObjects = new Map();
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(0x14141f);

    this.gridGraphics = this.add.graphics();
    this.selectionGraphics = this.add.graphics();

    this.board = this.rexBoard.add.board({
      grid: boardGridConfig(),
      width: EDITOR_MAX_COLUMNS,
      height: EDITOR_BOARD_ROWS,
    });
    // Scene-level pointer events instead of a dedicated full-screen touch
    // zone, so the board's tap detection coexists with this scene's own
    // pointer listeners below (used for drag-to-pan the camera).
    this.board.setInteractive({ useTouchZone: false });
    this.board.on('tiletap', this.onBoardTileTap, this);

    // Toolbar must be shown (and laid out) before the first zoom pass —
    // applyResponsiveZoom measures its rendered height to keep the camera
    // viewport above it, and a hidden ("display: none") toolbar measures
    // as 0px tall, which would let the camera draw the ground row behind
    // it on the very first frame.
    this.toolbar = EditorToolbar.instance();
    this.toolbar.setHandlers({
      onToolSelected: (tool) => {
        this.currentTool = tool;
        this.refreshSelectionHighlight();
      },
      onPanLeft: () => this.panZoom.panBy(-PAN_STEP_PX),
      onPanRight: () => this.panZoom.panBy(PAN_STEP_PX),
      onUndo: () =>
        this.applyMutation(() => this.controller.undo(), 'Nothing to undo.'),
      onRedo: () =>
        this.applyMutation(() => this.controller.redo(), 'Nothing to redo.'),
      onDelete: () =>
        this.applyMutation(
          () => this.controller.deleteSelected(),
          'Nothing selected.'
        ),
      onTest: () => void this.handleTest(),
      onPublishRequested: () => this.toolbar.showPublishDialog(),
      onPublishConfirm: (title) => void this.handlePublish(title),
      onPublishCancel: () => this.toolbar.hidePublishDialog(),
      onJsonRequested: () =>
        this.toolbar.showJsonDialog(this.controller.getObjects()),
      onJsonLoad: (objects) => this.scene.start('EditorScene', { objects }),
      onExit: () => this.scene.start('MainMenu'),
    });
    this.toolbar.setEditingEnabled(true);
    this.toolbar.setActiveTool('select');
    this.toolbar.show();
    this.updateToolbarState();

    // The DOM toolbar sits over the bottom of the canvas, not beside it —
    // PanZoomCamera shrinks the camera viewport to the area above it and
    // zooms to fit LOGICAL_HEIGHT into that smaller area, so the ground
    // row (and anything on it, including spawn) doesn't end up physically
    // behind the toolbar panel, unreachable.
    this.panZoom = new PanZoomCamera(this, 'editor-toolbar', () =>
      this.redrawGrid()
    );
    this.panZoom.attach();

    this.events.once('shutdown', this.cleanup, this);

    this.redrawObjects();
    this.redrawGrid();
  }

  private onBoardTileTap(
    _tap: unknown,
    tileXY: { x: number; y: number }
  ): void {
    if (this.testRequest || this.panZoom.shouldIgnoreTap()) return;
    const row = normalizeBoardRow(tileXY.y);
    const world = this.board.tileXYToWorldXY(tileXY.x, row);

    const tool = this.currentTool;
    if (tool === 'select') {
      this.handleSelectTap(world.x, world.y);
      return;
    }

    // Any type can go on any cell — Test (spec section 13) is what catches
    // an unbeatable layout, not the editor second-guessing placement.
    // Tapping an occupied cell replaces whatever was there.
    this.applyMutation(() =>
      this.controller.placeObject(tool, world.x, world.y)
    );
  }

  private handleSelectTap(x: number, y: number): void {
    if (this.controller.isSelectedAt(x, y)) {
      this.controller.deselect();
      this.refreshSelectionHighlight();
      this.updateToolbarState();
      return;
    }

    if (this.controller.canMoveSelectedTo(x, y)) {
      this.applyMutation(() => this.controller.moveSelectedTo(x, y));
      return;
    }

    const found = this.controller.selectAt(x, y);
    this.refreshSelectionHighlight();
    this.updateToolbarState();
    if (!found) {
      this.toolbar.showMessage('Nothing there to select — tap an object.');
    }
  }

  private applyMutation(
    mutate: () => boolean,
    noopMessage = 'Nothing changed.'
  ): void {
    if (this.testRequest) return;
    if (!mutate()) {
      this.toolbar.showMessage(noopMessage);
      return;
    }
    this.verified = false;
    this.verifiedToken = undefined;
    this.toolbar.hideMessage();
    this.redrawObjects();
    this.updateToolbarState();
  }

  private redrawObjects(): void {
    for (const tween of this.motionTweens) {
      tween.stop();
    }
    this.motionTweens = [];
    for (const image of this.renderedObjects.values()) {
      image.destroy();
    }
    this.renderedObjects.clear();
    for (const object of this.controller.getObjects()) {
      // ObjectRegistry deliberately renders nothing for 'spawn' (Player
      // reads its position directly at runtime, it's never an obstacle),
      // which left placing one with no visual confirmation in the editor
      // at all — indistinguishable from the tap having done nothing.
      const image =
        object.type === 'spawn'
          ? renderSpawnMarker(this, object.x, object.y)
          : renderLevelObject(this, {
              ...object,
              properties: {},
              addedBy: '',
              addedInVersion: 1,
            });
      if (image) {
        this.renderedObjects.set(object.id, image);
        const tweenConfig = motionTweenConfigFor(image, object);
        if (tweenConfig) {
          this.motionTweens.push(this.tweens.add(tweenConfig));
        }
      }
    }
    this.refreshSelectionHighlight();
  }

  private refreshSelectionHighlight(): void {
    this.selectionGraphics.clear();
    const selectedId = this.controller.getSelectedId();
    if (!selectedId) {
      return;
    }
    const selected = this.controller
      .getObjects()
      .find((o) => o.id === selectedId);
    if (!selected) {
      return;
    }
    this.selectionGraphics.lineStyle(3, 0x39ff88, 1);
    this.selectionGraphics.strokeRect(selected.x - 30, selected.y - 60, 60, 60);
  }

  private redrawGrid(): void {
    const { left, right } = this.panZoom.visibleWorldRangeX();
    drawGrid(this.gridGraphics, left, right);
  }

  private updateToolbarState(): void {
    this.toolbar.setUndoRedoEnabled(
      this.controller.canUndo(),
      this.controller.canRedo()
    );
    this.toolbar.setDeleteEnabled(
      this.controller.getSelectedId() !== undefined
    );
    this.toolbar.setPublishEnabled(this.verified);
  }

  private async handleTest(): Promise<void> {
    if (this.testRequest) return;
    const requestController = new AbortController();
    this.testRequest = requestController;
    this.verified = false;
    this.verifiedToken = undefined;
    this.toolbar.setEditingEnabled(false);
    const objects = this.controller.getObjects();
    this.toolbar.showMessage('Checking level...');
    try {
      const request: ValidateLevelRequest = { objects };
      const response = await fetch('/api/publish/validate', {
        signal: requestController.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const json: unknown = await response.json();
      if (this.testRequest !== requestController) return;
      if (!isValidateLevelResponse(json)) {
        this.toolbar.showMessage('Unexpected server response.');
        return;
      }
      if (json.status === 'error') {
        this.toolbar.showMessage(json.errors.join(' '));
        return;
      }
      this.toolbar.hideMessage();

      const previewLevel: LevelVersion = {
        levelId: 'preview',
        version: 1,
        parentVersion: null,
        objects: objects.map((o) => ({
          id: o.id,
          type: o.type,
          x: o.x,
          y: o.y,
          properties: {},
          addedBy: 'you',
          addedInVersion: 1,
        })),
        contributorUsername: 'you',
        verificationTimeMs: 0,
        createdAt: Date.now(),
      };
      this.scene.start('GameScene', {
        previewLevel,
        candidateToken: json.candidateToken,
        previewReturn: { kind: 'editor', objects },
      });
    } catch {
      if (this.testRequest === requestController) {
        this.toolbar.showMessage('Failed to reach the server.');
      }
    } finally {
      if (this.testRequest === requestController) {
        this.testRequest = undefined;
        this.toolbar.setEditingEnabled(true);
        this.updateToolbarState();
      }
    }
  }

  private async handlePublish(title: string): Promise<void> {
    if (!this.verified || !this.verifiedToken) {
      this.toolbar.showMessage('Test and beat the level before publishing.');
      return;
    }
    if (title.length === 0) {
      this.toolbar.showMessage('Give the level a title first.');
      return;
    }
    try {
      const response = await fetch('/api/publish/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateToken: this.verifiedToken,
          title,
          objects: this.controller.getObjects(),
        }),
      });
      const json: unknown = await response.json();
      if (!isPublishLevelResponse(json)) {
        this.toolbar.showMessage('Unexpected server response.');
        return;
      }
      if (json.status === 'error') {
        this.toolbar.showMessage(json.message);
        return;
      }
      this.toolbar.hidePublishDialog();
      showToast({
        text: json.postUrl
          ? 'Published! Your level has its own post now — share it.'
          : 'Published! Find it under Browse.',
        appearance: 'success',
      });
      this.scene.start('GameScene', { levelId: json.levelId });
    } catch {
      this.toolbar.showMessage('Failed to reach the server.');
    }
  }

  private cleanup(): void {
    this.testRequest?.abort();
    this.testRequest = undefined;
    // The board wires its own 'shutdown' -> destroy() hook when created
    // (Board's constructor registers it before this scene's own shutdown
    // listener below), so it tears itself down without help here.
    this.panZoom.detach();
    this.toolbar.hide();
  }
}
