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
import {
  isSeedLevelsResponse,
  seedLevelCode,
  snapSeedObjectsToGrid,
  type SeedLevelForEditor,
} from '../../../shared/seedEditorApi';
import type { LevelVersion } from '../../../shared/types';
import { EditorToolbar } from '../../ui/EditorToolbar';
import { EditorController } from '../editor/EditorController';
import {
  isDraftSaved,
  loadDraft,
  markDraftSaved,
  saveDraft,
} from '../editor/draftStore';
import {
  boardGridConfig,
  drawGrid,
  normalizeBoardRow,
  EDITOR_BOARD_ROWS,
  PAPER_COLOR,
  type EditorTool,
} from '../editor/GridSystem';
import { PanZoomCamera, PAN_STEP_PX } from '../editor/PanZoomCamera';
import { nearestTappedId } from '../editor/tapHit';
import {
  motionTweenConfigFor,
  renderLevelObject,
  renderSpawnMarker,
  terrainNeighborsIn,
} from '../objects/ObjectRegistry';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';
import { playPixelFx } from '../systems/Juice';
import { attachAmbience } from '../systems/TrapAmbience';

type EditorSceneData = {
  objects?: DraftObject[];
  verifiedCandidateToken?: string;
};

const DEFAULT_SPAWN = { x: GRID_CELL_SIZE * 1.5, y: GROUND_TOP_Y };

function defaultObjects(): DraftObject[] {
  return [
    {
      id: 'spawn-default',
      type: 'spawn',
      x: DEFAULT_SPAWN.x,
      y: DEFAULT_SPAWN.y,
    },
  ];
}
// Built-in levels a moderator can open (empty for everyone else), fetched
// once per session.
let seedLevelsRequest: Promise<SeedLevelForEditor[]> | undefined;

function fetchSeedLevels(): Promise<SeedLevelForEditor[]> {
  seedLevelsRequest ??= fetch('/api/editor/seeds')
    .then((response) => response.json())
    .then((json: unknown) => (isSeedLevelsResponse(json) ? json.levels : []))
    .catch(() => {
      seedLevelsRequest = undefined;
      return [];
    });
  return seedLevelsRequest;
}

// The built-in level a moderator is editing. Module state rather than scene
// data so it survives the Test run's round trip through GameScene; cleared
// whenever the editor is opened from the menu.
let editingSeed: SeedLevelForEditor | undefined;

// Above every placed object's own depth (all near 0 — see PaperScenery's
// depth constants) so the selection art never disappears behind a sprite.
const SELECTION_DEPTH = 1;
const SELECTION_BOX_SIZE = 64;

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
  private publishRequest: AbortController | undefined;
  private verified = false;
  private verifiedToken: string | undefined;
  // Opened from the menu (no level handed in): load the saved draft.
  private openSavedDraft = false;
  private draftRequest: AbortController | undefined;
  // Set after a failed save on Exit, so a second Exit leaves anyway.
  private exitWithoutSaving = false;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  // The Kenney ui_select corner-bracket art, scaled over the selected
  // object's 64x64 box — replaces the old drawSketchRect ink outline here
  // (CurseScene's own pending/suggestion outlines still use that helper;
  // see GridSystem.drawSketchRect's own comment).
  private selectionHighlight!: Phaser.GameObjects.Image;
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
    this.openSavedDraft = data.objects === undefined;
    if (this.openSavedDraft) editingSeed = undefined;
    this.exitWithoutSaving = false;
    this.controller = new EditorController(data.objects ?? defaultObjects());
    this.verified = data.verifiedCandidateToken !== undefined;
    this.verifiedToken = data.verifiedCandidateToken;
    this.currentTool = 'select';
    this.renderedObjects = new Map();
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(PAPER_COLOR);

    this.gridGraphics = this.add.graphics();
    this.selectionHighlight = this.add
      .image(0, 0, 'ui-select')
      .setDisplaySize(SELECTION_BOX_SIZE, SELECTION_BOX_SIZE)
      .setDepth(SELECTION_DEPTH)
      .setVisible(false);

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
      onDelete: () => this.deleteSelected(),
      onTest: () => void this.handleTest(),
      onSave: () => void this.handleSave(),
      onPublishRequested: () => this.toolbar.showPublishDialog(),
      onPublishConfirm: (title) => void this.handlePublish(title),
      onPublishCancel: () => this.toolbar.hidePublishDialog(),
      onJsonRequested: () => {
        const objects = this.controller.getObjects();
        this.toolbar.showJsonDialog(
          objects,
          editingSeed &&
            seedLevelCode(editingSeed.levelId, objects, editingSeed.verificationTimeMs)
        );
      },
      onSeedLevelOpen: (levelId) => this.openSeedLevel(levelId),
      onJsonLoad: (objects) => this.scene.start('EditorScene', { objects }),
      onExit: () => void this.handleExit(),
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
    if (this.openSavedDraft) void this.openDraft();
    void this.showSeedLevels();
  }

  private async showSeedLevels(): Promise<void> {
    const levels = await fetchSeedLevels();
    if (!this.scene.isActive()) return;
    this.toolbar.setSeedLevels(levels);
    if (editingSeed) {
      this.toolbar.showMessage(
        `Editing built-in level ${editingSeed.title}. More → Import / export JSON → Copy as code. Changes aren't saved.`
      );
    }
  }

  // Moderators only: swap the editor over to a built-in level. The
  // player's own unsaved work is saved for later first, and nothing from
  // the built-in level is ever saved as their draft.
  private openSeedLevel(levelId: string): void {
    void fetchSeedLevels().then((levels) => {
      const seed = levels.find((level) => level.levelId === levelId);
      if (!seed || !this.scene.isActive()) return;
      const objects = this.controller.getObjects();
      if (!editingSeed && !isDraftSaved(objects)) void saveDraft(objects);
      editingSeed = seed;
      this.scene.restart({ objects: snapSeedObjectsToGrid(seed.objects) });
    });
  }

  // Build from the menu picks up the player's saved level, if any.
  private async openDraft(): Promise<void> {
    const request = new AbortController();
    this.draftRequest = request;
    this.toolbar.setEditingEnabled(false);
    this.toolbar.showMessage('Loading your saved level...');
    // Nothing here to save yet, so Exit just leaves.
    this.exitWithoutSaving = true;
    let objects: DraftObject[] | null = null;
    let failed = false;
    try {
      objects = await loadDraft();
    } catch {
      failed = true;
    }
    // The player may have left the editor while this was in flight.
    if (request.signal.aborted) return;
    this.draftRequest = undefined;
    this.exitWithoutSaving = false;
    // No draft counts as the empty starting level, so leaving that
    // untouched doesn't save it.
    markDraftSaved(objects ?? defaultObjects());
    if (objects && objects.length > 0) {
      this.scene.restart({ objects });
      return;
    }
    this.toolbar.setEditingEnabled(true);
    this.updateToolbarState();
    if (failed) this.toolbar.showMessage("Couldn't load your saved level.");
    else this.toolbar.hideMessage();
  }

  private async handleSave(): Promise<void> {
    if (editingSeed) {
      this.toolbar.showMessage(
        "Built-in levels aren't saved here. Use More → Import / export JSON → Copy as code."
      );
      return;
    }
    if (this.draftRequest) return;
    const request = new AbortController();
    this.draftRequest = request;
    this.toolbar.showMessage('Saving...');
    const saved = await saveDraft(this.controller.getObjects());
    if (request.signal.aborted) return;
    this.draftRequest = undefined;
    if (saved) {
      this.toolbar.hideMessage();
      showToast('Level saved. Press Build to pick it up later.');
    } else {
      this.toolbar.showMessage("Couldn't save your level. Try again.");
    }
  }

  // Exit always saves first, unless nothing changed since the last save.
  private async handleExit(): Promise<void> {
    const objects = this.controller.getObjects();
    if (this.exitWithoutSaving || editingSeed || isDraftSaved(objects)) {
      this.scene.start('MainMenu');
      return;
    }
    if (this.draftRequest) return;
    const request = new AbortController();
    this.draftRequest = request;
    this.toolbar.setEditingEnabled(false);
    this.toolbar.showMessage('Saving...');
    const saved = await saveDraft(objects);
    if (request.signal.aborted) return;
    this.draftRequest = undefined;
    if (saved) {
      showToast('Level saved for later.');
      this.scene.start('MainMenu');
      return;
    }
    this.exitWithoutSaving = true;
    this.toolbar.setEditingEnabled(true);
    this.updateToolbarState();
    this.toolbar.showMessage(
      "Couldn't save your level. Press Exit again to leave without saving."
    );
  }

  private onBoardTileTap(
    pointer: Phaser.Input.Pointer,
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
    if (tool === 'erase') {
      const tapped = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.handleEraseTap(world.x, world.y, tapped.x, tapped.y);
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

  // One tap, one object gone — no select-then-Delete. (x, y) is the tapped
  // cell, (tapX, tapY) the raw tap point used by the lenient fallbacks.
  private handleEraseTap(x: number, y: number, tapX: number, tapY: number): void {
    let spawnTapped = false;
    this.applyMutation(() => {
      const id = this.controller.topObjectIdAt(x, y) ?? nearestTappedId(this.renderedObjects, tapX, tapY);
      if (id === undefined) return false;
      const erased = this.controller.eraseById(id);
      if (erased === 'spawn') {
        spawnTapped = true;
        return false;
      }
      if (!erased) return false;
      const at = this.renderedObjects.get(erased.id)?.getCenter();
      if (at) this.puffAt(at);
      return true;
    }, 'Nothing to erase there.');
    if (spawnTapped) this.toolbar.showMessage('Every level needs a spawn. Use Select to move it.');
  }

  // A puff of smoke where a removed object was. Drawn above the objects,
  // which applyMutation rebuilds right after.
  private puffAt(at: { x: number; y: number }): void {
    playPixelFx(this, 'smoke-poof', at.x, at.y, { scale: 1, depth: 10 });
  }

  private deleteSelected(): void {
    const selectedId = this.controller.getSelectedId();
    const image = selectedId ? this.renderedObjects.get(selectedId) : undefined;
    const center = image?.getCenter();
    this.applyMutation(() => {
      const deleted = this.controller.deleteSelected();
      if (deleted && center) this.puffAt(center);
      return deleted;
    }, 'Nothing selected.');
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
    const neighborsOf = terrainNeighborsIn(this.controller.getObjects());
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
            }, neighborsOf(object));
      if (image) {
        this.renderedObjects.set(object.id, image);
        const tweenConfig = motionTweenConfigFor(image, object);
        if (tweenConfig) {
          this.motionTweens.push(this.tweens.add(tweenConfig));
        }
        attachAmbience(this, image, object);
      }
    }
    this.refreshSelectionHighlight();
  }

  private refreshSelectionHighlight(): void {
    const selectedId = this.controller.getSelectedId();
    const selected = selectedId
      ? this.controller.getObjects().find((o) => o.id === selectedId)
      : undefined;
    if (!selected) {
      this.selectionHighlight.setVisible(false);
      return;
    }
    // Same 64x64 box the old drawSketchRect outline covered (x-32, y-62 as
    // its top-left corner) — centered here instead, since Image positions
    // from its own origin (0.5 by default) rather than a top-left corner.
    this.selectionHighlight
      .setPosition(selected.x, selected.y - 62 + SELECTION_BOX_SIZE / 2)
      .setVisible(true);
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
    // A Test run can end anywhere (even Exit to Menu mid-run), so the
    // level is saved for later on the way in.
    if (!editingSeed && !isDraftSaved(objects)) void saveDraft(objects);
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
    if (this.publishRequest) return;
    const requestController = new AbortController();
    this.publishRequest = requestController;
    try {
      const response = await fetch('/api/publish/publish', {
        signal: requestController.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateToken: this.verifiedToken,
          title,
          objects: this.controller.getObjects(),
        }),
      });
      const json: unknown = await response.json();
      // The player may have left the editor while this was in flight.
      if (this.publishRequest !== requestController) return;
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
      if (this.publishRequest === requestController) {
        this.toolbar.showMessage('Failed to reach the server.');
      }
    } finally {
      if (this.publishRequest === requestController) {
        this.publishRequest = undefined;
      }
    }
  }

  private cleanup(): void {
    this.draftRequest?.abort();
    this.draftRequest = undefined;
    this.testRequest?.abort();
    this.testRequest = undefined;
    this.publishRequest?.abort();
    this.publishRequest = undefined;
    // The board wires its own 'shutdown' -> destroy() hook when created
    // (Board's constructor registers it before this scene's own shutdown
    // listener below), so it tears itself down without help here.
    this.panZoom.detach();
    this.toolbar.hide();
  }
}
