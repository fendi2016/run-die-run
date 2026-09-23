import { Scene } from 'phaser';
import type * as Phaser from 'phaser';
import BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import { EDITOR_MAX_COLUMNS } from '../../../shared/constants';
import {
  isProposeCurseResponse,
  type CurseCategory,
  type DraftObject,
  type ProposeCurseRequest,
} from '../../../shared/editorApi';
import {
  computeLevelExtension,
  tilesNeededToReach,
  LEVEL_EXTEND_CHUNK_TILES,
  type LevelExtension,
} from '../../../shared/levelExtend';
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
import {
  renderLevelObject,
  renderSpawnMarker,
} from '../objects/ObjectRegistry';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

type CursePreselect = {
  category: CurseCategory;
  object: DraftObject;
  extendByTiles?: number;
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
  // The level-extend add-on (shared/levelExtend.ts) — a requested tile
  // count, not the computed ground/finish objects themselves (those are
  // derived live via currentExtension() so there's exactly one place that
  // does the math, same reasoning as the server recomputing it from this
  // same count rather than trusting positions over the wire). Grows either
  // from an explicit "Extend Level" tap (extendByChunk) or implicitly when
  // the pending object is placed past the level's current end
  // (growExtensionToReach) — never shrinks except via Clear.
  private pendingExtendTiles = 0;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private pendingGraphics!: Phaser.GameObjects.Graphics;
  private baseImages: Phaser.GameObjects.Sprite[] = [];
  private extensionImages: Phaser.GameObjects.Sprite[] = [];
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
  private pendingImage: Phaser.GameObjects.Sprite | undefined;

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
    this.pendingExtendTiles = data.preselected?.extendByTiles ?? 0;
    this.initialMessage = data.message;
    this.baseImages = [];
    this.extensionImages = [];
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
      onExtend: () => this.extendByChunk(),
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
      this.redrawPending();
      this.redrawExtension();
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
    this.toolbar.setClearEnabled(false);
    this.redrawPending();
    this.updateProveEnabled();
    this.toolbar.showMessage('Tap an empty spot to place your curse.');
  }

  // Keep tap placement and drag repositioning in sync with the toolbar.
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
    this.pendingExtendTiles = 0;
    this.toolbar.setClearEnabled(false);
    this.toolbar.hideMessage();
    this.redrawBase();
    this.redrawPending();
    this.redrawExtension();
    this.updateProveEnabled();
  }

  private onBoardTileTap(
    _tap: unknown,
    tileXY: { x: number; y: number }
  ): void {
    if (this.panZoom.shouldIgnoreTap()) return;
    if (this.proposalRequest || !this.baseLevel) return;
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
    this.growExtensionToReach(world.x);
    this.setPendingAt(world.x, world.y);
  }

  private isOccupiedByBase(x: number, y: number): boolean {
    if (
      (this.baseLevel?.objects ?? []).some(
        (o) => o.type !== 'ground' && o.x === x && o.y === y
      )
    ) {
      return true;
    }
    const extension = this.currentExtension();
    return (
      extension !== undefined && extension.finish.x === x && extension.finish.y === y
    );
  }

  private updateProveEnabled(): void {
    const ready =
      !this.proposalRequest &&
      this.baseLevel !== undefined &&
      this.pending !== undefined &&
      !this.isOccupiedByBase(this.pending.x, this.pending.y);
    this.toolbar.setProveEnabled(ready);
  }

  private baseObjectsAsDraft(): DraftObject[] {
    return (this.baseLevel?.objects ?? []).map((o) => ({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
    }));
  }

  // Computed fresh every call rather than cached — cheap at this object
  // count, and it means every caller (rendering, collision checks, the
  // Prove request) is always looking at the same live math instead of a
  // snapshot that could drift from pendingExtendTiles. Preview-only ids
  // (the server never sees them — see ProposeCurseRequest.extendByTiles's
  // comment on why only the tile count crosses the wire).
  private currentExtension(): LevelExtension | undefined {
    if (this.pendingExtendTiles <= 0) {
      return undefined;
    }
    let groundIndex = 0;
    return computeLevelExtension(
      this.baseObjectsAsDraft(),
      this.pendingExtendTiles,
      () => `ext-ground-${groundIndex++}`,
      () => 'ext-finish'
    );
  }

  // Grows the pending extension (never shrinks it) just far enough for a
  // chunk of ground to reach world-x `x` — called when the player places
  // their object past the level's current end, so dragging the trap out
  // there "just works" without needing to also find and tap Extend Level
  // first. tilesNeededToReach is measured from the level's original end
  // (same reference point computeLevelExtension itself uses), so comparing
  // it against pendingExtendTiles directly is safe.
  private growExtensionToReach(x: number): void {
    const needed = tilesNeededToReach(this.baseObjectsAsDraft(), x);
    if (needed > this.pendingExtendTiles) {
      this.pendingExtendTiles = needed;
      this.redrawBase();
      this.redrawExtension();
    }
  }

  // The explicit "Extend Level" button — adds one fixed chunk on top of
  // whatever's already pending. Reverts the increment (rather than just
  // leaving pendingExtendTiles inflated past what computeLevelExtension
  // will ever actually place) when the level's already at its max width,
  // so a second tap doesn't show the same "at the maximum" message.
  private extendByChunk(): void {
    if (this.proposalRequest || !this.baseLevel) return;
    const before = this.currentExtension()?.groundTiles.length ?? 0;
    this.pendingExtendTiles += LEVEL_EXTEND_CHUNK_TILES;
    const after = this.currentExtension()?.groundTiles.length ?? 0;
    if (after === before) {
      this.pendingExtendTiles -= LEVEL_EXTEND_CHUNK_TILES;
      this.toolbar.showMessage('Level is already at the maximum length.');
      return;
    }
    this.toolbar.showMessage('Extended the level — pan right to see it.');
    this.redrawBase();
    this.redrawExtension();
    this.updateProveEnabled();
  }

  // Hides the base level's own finish while an extension is pending — it's
  // being relocated, and redrawExtension() renders the new one in its
  // place — so the player never sees two finish portals at once.
  private redrawBase(): void {
    for (const image of this.baseImages) {
      image.destroy();
    }
    this.baseImages = [];
    const relocatingFinish = this.pendingExtendTiles > 0;
    for (const object of this.baseLevel?.objects ?? []) {
      if (relocatingFinish && object.type === 'finish') {
        continue;
      }
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

  private redrawExtension(): void {
    for (const image of this.extensionImages) {
      image.destroy();
    }
    this.extensionImages = [];
    const extension = this.currentExtension();
    if (!extension) {
      return;
    }
    for (const tile of [...extension.groundTiles, extension.finish]) {
      const previewObject: LevelObject = {
        id: tile.id,
        type: tile.type,
        x: tile.x,
        y: tile.y,
        properties: {},
        addedBy: 'you',
        addedInVersion: 0,
      };
      const image = renderLevelObject(this, previewObject);
      if (image) {
        image.disableInteractive();
        this.extensionImages.push(image);
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
    if (this.proposalRequest || !this.selectedType || !this.pendingImage)
      return;

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
    this.growExtensionToReach(snapped.x);
    this.setPendingAt(snapped.x, snapped.y);
  }

  private redrawGrid(): void {
    const { left, right } = this.panZoom.visibleWorldRangeX();
    drawGrid(this.gridGraphics, left, right);
  }

  private async handleProve(): Promise<void> {
    if (this.proposalRequest || !this.pending || !this.category) {
      return;
    }
    const category = this.category;
    const pending = { ...this.pending };
    const levelId = this.levelId;
    const extendByTiles = this.pendingExtendTiles;
    const requestId = {};
    this.proposalRequest = requestId;
    this.toolbar.setEditingEnabled(false);
    this.updateProveEnabled();
    this.toolbar.showMessage('Checking your curse...');
    try {
      const request: ProposeCurseRequest = {
        levelId,
        object: pending,
        extendByTiles: extendByTiles > 0 ? extendByTiles : undefined,
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
          extendByTiles: extendByTiles > 0 ? extendByTiles : undefined,
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
