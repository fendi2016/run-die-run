import { Scene } from 'phaser';
import type * as Phaser from 'phaser';
import BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import {
  EDITOR_MAX_COLUMNS,
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
} from '../../../shared/constants';
import {
  isProposeCurseResponse,
  type CurseCategory,
  type DraftObject,
  type ProposeCurseRequest,
} from '../../../shared/editorApi';
import {
  isLevelVersion,
  type LevelObject,
  type LevelVersion,
  type ObjectType,
} from '../../../shared/types';
import { CurseToolbar } from '../../ui/CurseToolbar';
import {
  boardGridConfig,
  clampBoardColumn,
  drawGrid,
  normalizeBoardRow,
  EDITOR_BOARD_ROWS,
} from '../editor/GridSystem';
import { PanZoomCamera, PAN_STEP_PX } from '../editor/PanZoomCamera';
import { renderLevelObject, renderSpawnMarker } from '../objects/ObjectRegistry';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

type CursePreselect = {
  category: CurseCategory;
  object: DraftObject;
};

type CurseSceneData = {
  levelId: string;
  preselected?: CursePreselect;
  message?: string;
};

// The curse flow's placement screen (spec sections 14-15): a deliberately
// smaller component than EditorScene. It renders the level's currently
// published objects read-only — nothing here can select, move, or delete
// them — and lets the player place exactly one new object from a
// restricted category set before proving it's beatable in the real
// GameScene (spec section 16).
export class CurseScene extends Scene {
  private rexBoard!: BoardPlugin;
  private board!: BoardPlugin.Board;

  private toolbar!: CurseToolbar;
  private levelId = '';
  private proposalRequest: object | undefined;
  private baseLevel: LevelVersion | undefined;
  private category: CurseCategory | undefined;
  private selectedType: ObjectType | undefined;
  private pending: DraftObject | undefined;
  private initialMessage: string | undefined;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private pendingGraphics!: Phaser.GameObjects.Graphics;
  private baseImages: Phaser.GameObjects.Image[] = [];
  // Placement uses rexBoard's own tile math (Board.worldXYToTileXY /
  // tileXYToWorldXY — the same calls tap-to-place already used) for
  // snapping, and Phaser's native GameObject drag for the pointer gesture.
  // rexBoard also ships a higher-level MiniBoard ("palette piece" that
  // drags onto a board and snaps itself) that looked like an even better
  // fit — but its own drag detection (isInTouching -> GetPointerWorldXY)
  // resolves the pointer against the wrong camera in a scene with a
  // resized viewport (confirmed by reading its source and tracing actual
  // pointer.camera values at runtime: it never matched this scene's own
  // camera, even though the Board's tap detection — the same mechanism a
  // plain draggable GameObject also uses — resolves correctly). That's a
  // real bug in that specific sub-feature, not something fixable from
  // here, so the drag gesture itself is native Phaser instead.
  private pendingImage: Phaser.GameObjects.Image | undefined;

  private panZoom!: PanZoomCamera;

  constructor() {
    super('CurseScene');
  }

  init(data: CurseSceneData): void {
    this.proposalRequest = undefined;
    this.levelId = data.levelId;
    this.baseLevel = undefined;
    this.category = data.preselected?.category;
    this.selectedType = data.preselected?.object.type;
    this.pending = data.preselected?.object;
    this.initialMessage = data.message;
    this.baseImages = [];
    this.pendingImage = undefined;
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(0x14141f);

    this.gridGraphics = this.add.graphics();
    this.pendingGraphics = this.add.graphics();

    this.board = this.rexBoard.add.board({
      grid: boardGridConfig(),
      width: EDITOR_MAX_COLUMNS,
      height: EDITOR_BOARD_ROWS,
    });
    this.board.setInteractive({ useTouchZone: false });
    this.board.on('tiletap', this.onBoardTileTap, this);

    this.toolbar = CurseToolbar.instance();
    this.toolbar.setHandlers({
      onCategorySelected: (category) => this.selectCategory(category),
      onTypeSelected: (type) => this.selectType(type),
      onPanLeft: () => this.panZoom.panBy(-PAN_STEP_PX),
      onPanRight: () => this.panZoom.panBy(PAN_STEP_PX),
      onClear: () => this.clearPending(),
      onProve: () => void this.handleProve(),
      onCancel: () => this.scene.start('MainMenu'),
    });
    this.toolbar.setActiveCategory(this.category);
    this.toolbar.setActiveType(this.selectedType);
    this.toolbar.setClearEnabled(this.pending !== undefined);
    this.toolbar.setProveEnabled(false);
    this.toolbar.show();
    if (this.initialMessage) {
      this.toolbar.showMessage(this.initialMessage);
    }

    this.panZoom = new PanZoomCamera(this, 'curse-toolbar', () =>
      this.redrawGrid()
    );
    this.panZoom.attach();

    this.events.once('shutdown', this.cleanup, this);

    void this.loadBaseLevel();
  }

  private async loadBaseLevel(): Promise<void> {
    try {
      const response = await fetch(
        `/api/levels/${encodeURIComponent(this.levelId)}`
      );
      if (!response.ok) {
        this.toolbar.showMessage('Could not load this level.');
        return;
      }
      const body: unknown = await response.json();
      if (!isLevelVersion(body)) {
        this.toolbar.showMessage('Unexpected server response.');
        return;
      }
      this.baseLevel = body;
      this.redrawBase();
      // A type picked before the base level finished loading (selectType
      // couldn't place it yet without knowing where the level currently
      // ends) gets placed now instead of leaving the player with a type
      // selected but nothing on the board. A preselected object already
      // has a real position, so it's just (re)rendered as-is.
      if (this.selectedType && !this.pending) {
        this.placePendingAtEndOfLevel();
      } else {
        this.redrawPending();
      }
      this.updateProveEnabled();
    } catch {
      this.toolbar.showMessage('Failed to reach the server.');
    }
  }

  private selectCategory(category: CurseCategory): void {
    if (this.proposalRequest) return;
    this.category = category;
    this.selectedType = undefined;
    this.pending = undefined;
    this.toolbar.setActiveType(undefined);
    this.toolbar.setClearEnabled(false);
    this.toolbar.hideMessage();
    this.redrawPending();
    this.updateProveEnabled();
  }

  private selectType(type: ObjectType): void {
    if (this.proposalRequest) return;
    this.selectedType = type;
    this.pending = undefined;
    this.toolbar.hideMessage();
    // Drop the new object right at the end of the level instead of making
    // the player hunt for an empty tile first — they can then drag it
    // anywhere else they'd rather have it (including further right, to
    // extend how far the level reaches).
    if (this.baseLevel) {
      this.placePendingAtEndOfLevel();
    } else {
      this.toolbar.setClearEnabled(false);
      this.redrawPending();
      this.updateProveEnabled();
    }
  }

  // Snaps to the same board math tile taps use (Board.worldXYToTileXY /
  // tileXYToWorldXY), one column past whatever currently reaches furthest
  // right (spawn included, so an empty level still gets a sane starting
  // column instead of x=0).
  private placePendingAtEndOfLevel(): void {
    if (!this.selectedType) return;
    const maxX = Math.max(
      0,
      ...(this.baseLevel?.objects ?? []).map((o) => o.x)
    );
    const targetTile = this.board.worldXYToTileXY(
      maxX + GRID_CELL_SIZE,
      GROUND_TOP_Y
    );
    const col = clampBoardColumn(targetTile.x);
    const row = normalizeBoardRow(targetTile.y);
    const world = this.board.tileXYToWorldXY(col, row);
    // The column clamp above can land back on an already-occupied tile
    // once the level is full out to EDITOR_MAX_COLUMNS — same conflict
    // check tap/drag placement use, so Prove's silent "why won't this
    // enable" doesn't come as a surprise.
    if (this.isOccupiedByBase(world.x, world.y)) {
      this.toolbar.showMessage(
        'Level is full — drag the new object to an empty spot.'
      );
    }
    this.setPendingAt(world.x, world.y);
    this.panZoom.focusOn(world.x);
  }

  // Shared by the initial end-of-level placement, tap-to-place/move, and
  // drag-to-reposition — one place that keeps `pending`, the toolbar's
  // Clear button, and the preview render all in sync with each other.
  private setPendingAt(x: number, y: number): void {
    if (!this.selectedType) return;
    this.pending = { id: 'pending', type: this.selectedType, x, y };
    this.toolbar.setClearEnabled(true);
    this.redrawPending();
    this.updateProveEnabled();
  }

  private clearPending(): void {
    if (this.proposalRequest) return;
    this.pending = undefined;
    this.toolbar.setClearEnabled(false);
    this.redrawPending();
    this.updateProveEnabled();
  }

  private onBoardTileTap(
    _tap: unknown,
    tileXY: { x: number; y: number }
  ): void {
    if (this.proposalRequest) return;
    if (!this.selectedType) {
      this.toolbar.showMessage('Choose a curse type first.');
      return;
    }
    const row = normalizeBoardRow(tileXY.y);
    const world = this.board.tileXYToWorldXY(tileXY.x, row);

    if (this.isOccupiedByBase(world.x, world.y)) {
      this.toolbar.showMessage(
        'Something is already there — try another spot.'
      );
      return;
    }

    this.toolbar.hideMessage();
    this.setPendingAt(world.x, world.y);
  }

  private isOccupiedByBase(x: number, y: number): boolean {
    return (this.baseLevel?.objects ?? []).some((o) => o.type !== 'ground' && o.x === x && o.y === y);
  }

  private updateProveEnabled(): void {
    const ready =
      !this.proposalRequest &&
      this.baseLevel !== undefined &&
      this.pending !== undefined &&
      !this.isOccupiedByBase(this.pending.x, this.pending.y);
    this.toolbar.setProveEnabled(ready);
  }

  private redrawBase(): void {
    for (const image of this.baseImages) {
      image.destroy();
    }
    this.baseImages = [];
    for (const object of this.baseLevel?.objects ?? []) {
      const image =
        object.type === 'spawn'
          ? renderSpawnMarker(this, object.x, object.y)
          : renderLevelObject(this, object);
      if (image) {
        image.disableInteractive();
        this.baseImages.push(image);
      }
    }
  }

  private redrawPending(): void {
    this.pendingGraphics.clear();
    this.pendingImage?.destroy();
    this.pendingImage = undefined;
    if (!this.pending) {
      return;
    }
    const previewObject: LevelObject = {
      id: this.pending.id,
      type: this.pending.type,
      x: this.pending.x,
      y: this.pending.y,
      properties: {},
      addedBy: 'you',
      addedInVersion: 0,
    };
    const image = renderLevelObject(this, previewObject);
    if (image) {
      image.setAlpha(0.85);
      image.setInteractive();
      this.input.setDraggable(image);
      image.on('pointerdown', () => this.panZoom.setSuspended(true));
      image.on('drag', (_p: unknown, dragX: number, dragY: number) =>
        this.onPendingDrag(dragX, dragY)
      );
      // Deliberately ignores the dragend event's own (dragX, dragY)
      // payload — Phaser 4.2.1's processDragUpEvent recomputes
      // input.dragX/dragY from local (object-relative) coordinates instead
      // of world coordinates when the pointer's internal per-object
      // dragState still reads 2 at release, which happens here despite
      // real 'drag' moves already having fired (confirmed by tracing
      // actual values at runtime — a real engine quirk, not a mistake in
      // this file). The image's own x/y, kept correct every tick by
      // onPendingDrag's setPosition() call below, isn't affected by that
      // and is what's used instead.
      image.on('dragend', () => this.onPendingDragEnd());
      this.pendingImage = image;
    }
    this.drawPendingOutline(this.pending.x, this.pending.y);
  }

  private drawPendingOutline(x: number, y: number): void {
    this.pendingGraphics.clear();
    this.pendingGraphics.lineStyle(3, 0xff3966, 1);
    this.pendingGraphics.strokeRect(x - 30, y - 60, 60, 60);
  }

  // Live-follows the pointer during the drag itself — snapping only
  // happens once on release (onPendingDragEnd), same as picking up a real
  // object and setting it down, rather than jittering between tiles while
  // still mid-drag.
  private onPendingDrag(dragX: number, dragY: number): void {
    if (this.proposalRequest || !this.pendingImage) return;
    this.pendingImage.setPosition(dragX, dragY);
    this.drawPendingOutline(dragX, dragY);
  }

  private onPendingDragEnd(): void {
    this.panZoom.setSuspended(false);
    if (this.proposalRequest || !this.selectedType || !this.pendingImage) return;

    const droppedTile = this.board.worldXYToTileXY(
      this.pendingImage.x,
      this.pendingImage.y
    );
    const col = clampBoardColumn(droppedTile.x);
    const row = normalizeBoardRow(droppedTile.y);
    const snapped = this.board.tileXYToWorldXY(col, row);

    if (this.isOccupiedByBase(snapped.x, snapped.y)) {
      this.toolbar.showMessage(
        'Something is already there — try another spot.'
      );
      // Snap the visual back to the last confirmed position rather than
      // leaving it hovering wherever the drop was rejected.
      this.redrawPending();
      return;
    }

    this.toolbar.hideMessage();
    this.setPendingAt(snapped.x, snapped.y);
  }

  private redrawGrid(): void {
    const zoom = this.cameras.main.zoom;
    const scrollX = this.cameras.main.scrollX;
    const visibleWorldWidth = this.scale.width / zoom;
    drawGrid(this.gridGraphics, scrollX, scrollX + visibleWorldWidth);
  }

  private async handleProve(): Promise<void> {
    if (this.proposalRequest || !this.pending || !this.category) {
      return;
    }
    const category = this.category;
    const pending = { ...this.pending };
    const levelId = this.levelId;
    const requestId = {};
    this.proposalRequest = requestId;
    this.toolbar.setEditingEnabled(false);
    this.updateProveEnabled();
    this.toolbar.showMessage('Checking your curse...');
    try {
      const request: ProposeCurseRequest = {
        levelId,
        object: pending,
      };
      const response = await fetch('/api/curse/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const json: unknown = await response.json();
      if (this.proposalRequest !== requestId) return;
      if (!isProposeCurseResponse(json)) {
        this.toolbar.showMessage('Unexpected server response.');
        return;
      }
      if (json.status === 'error') {
        this.toolbar.showMessage(json.errors.join(' '));
        return;
      }
      this.toolbar.hideMessage();

      const object: DraftObject = { ...pending, id: json.objectId };
      const previewLevel = json.previewLevel;

      this.scene.start('GameScene', {
        previewLevel,
        candidateToken: json.candidateToken,
        previewReturn: {
          kind: 'curse',
          levelId,
          category,
          object,
        },
      });
    } catch {
      if (this.proposalRequest === requestId) {
        this.toolbar.showMessage('Failed to reach the server.');
      }
    } finally {
      if (this.proposalRequest === requestId) {
        this.proposalRequest = undefined;
        this.toolbar.setEditingEnabled(true);
        this.updateProveEnabled();
      }
    }
  }

  private cleanup(): void {
    this.proposalRequest = undefined;
    this.toolbar.setEditingEnabled(true);
    this.panZoom.detach();
    this.toolbar.hide();
  }
}
