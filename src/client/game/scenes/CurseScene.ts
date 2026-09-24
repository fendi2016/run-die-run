import { Scene } from 'phaser';
import type * as Phaser from 'phaser';
import BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import { EDITOR_MAX_COLUMNS } from '../../../shared/constants';
import {
  CURSE_CATEGORY_TYPES,
  isProposeCurseResponse,
  isSurfaceType,
  type CurseCategory,
  type DraftObject,
  type ProposeCurseRequest,
} from '../../../shared/editorApi';
import {
  computeLevelExtension,
  maxExtendableTiles,
  tilesNeededToReach,
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
  motionTweenConfigFor,
  renderLevelObject,
  renderSpawnMarker,
} from '../objects/ObjectRegistry';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

type CursePreselect = {
  category: CurseCategory;
  object: DraftObject;
  extendByTiles?: number;
  removeObjectId?: string;
};

type CurseSceneData = {
  levelId: string;
  preselected?: CursePreselect;
  message?: string;
};

// The same "platform" family the curse UI's own category picker already
// groups together (shared/editorApi.ts) — reused here rather than a second
// hardcoded list, so a removable base-level object is always exactly
// whatever the platform category can also place.
const REMOVABLE_PLATFORM_TYPES = new Set<ObjectType>(
  CURSE_CATEGORY_TYPES.platform
);

// The curse flow's placement screen (spec sections 14-15): a deliberately
// smaller component than EditorScene. It renders the level's currently
// published objects read-only — nothing here can select, move, or delete
// them, except one add-on: tapping an existing platform/movingPlatform
// marks it for removal (see toggleRemoveTarget) — and lets the player
// place exactly one new object from a restricted category set before
// proving it's beatable in the real GameScene (spec section 16). Removing
// a platform is always alongside placing that object, never a substitute
// for it, same "the leaderboard is gauged by curse kills" reasoning
// pendingExtendTiles's own comment gives for Extend Level.
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
  // from an explicit "Extend Level" tap (extendLevel — one click maxes it
  // out, no re-tappable chunk) or implicitly when
  // the pending object is placed past the level's current end
  // (growExtensionToReach) — never shrinks except via Clear.
  private pendingExtendTiles = 0;
  // The id of an existing base-level platform/movingPlatform marked for
  // removal (see toggleRemoveTarget) — at most one at a time, toggled by
  // tapping it again or switched by tapping a different removable object,
  // mirroring pendingExtendTiles's own "exactly one add-on" scope. Reset to
  // undefined (never removed) except via Clear.
  private pendingRemoveId: string | undefined;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private pendingGraphics!: Phaser.GameObjects.Graphics;
  private baseImages: Phaser.GameObjects.Sprite[] = [];
  private extensionImages: Phaser.GameObjects.Sprite[] = [];
  // Patrol/drift/rideable tweens for the objects above (see ObjectRegistry's
  // motionTweenConfigFor) — a bat/ghost/movingSaw/movingPlatform in the base
  // level or the extension preview previously sat frozen here even though
  // every other hazard's spin animation already played. Stopped and rebuilt
  // alongside their sprites on every redraw, same reasoning as EditorScene's
  // own motionTweens field: leaving a repeat: -1 tween running against a
  // destroyed sprite would leak one on every redraw instead of replacing it.
  private baseMotionTweens: Phaser.Tweens.Tween[] = [];
  private extensionMotionTweens: Phaser.Tweens.Tween[] = [];
  // The single object currently being placed/dragged (see redrawPending) —
  // paused for the duration of a drag so the tween's own per-frame x/y
  // writes don't fight onPendingDrag's setPosition, then simply left to be
  // stopped and replaced the next time redrawPending runs (every drag ends
  // in either a rejected drop, which calls redrawPending itself, or an
  // accepted one via setPendingAt, which does the same).
  private pendingMotionTween: Phaser.Tweens.Tween | undefined;
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
    this.pendingRemoveId = data.preselected?.removeObjectId;
    this.initialMessage = data.message;
    this.baseImages = [];
    this.extensionImages = [];
    this.baseMotionTweens = [];
    this.extensionMotionTweens = [];
    this.pendingMotionTween = undefined;
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
      onExtend: () => this.extendLevel(),
      onRemove: () => this.showRemoveHint(),
      onClear: () => this.clearPending(),
      onProve: () => void this.handleProve(),
      onCancel: () => this.scene.start('MainMenu'),
    });
    this.toolbar.setActiveCategory(this.category);
    this.toolbar.setActiveType(this.selectedType);
    this.updateClearEnabled();
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
    this.updateClearEnabled();
    this.toolbar.hideMessage();
    this.redrawPending();
    this.updateProveEnabled();
  }

  private selectType(type: ObjectType): void {
    if (this.proposalRequest) return;
    this.selectedType = type;
    this.pending = undefined;
    this.toolbar.hideMessage();
    this.updateClearEnabled();
    this.redrawPending();
    this.updateProveEnabled();
    this.toolbar.showMessage('Tap an empty spot to place your curse.');
  }

  // Keep tap placement and drag repositioning in sync with the toolbar.
  private setPendingAt(x: number, y: number): void {
    if (!this.selectedType) return;
    this.pending = { id: 'pending', type: this.selectedType, x, y };
    this.updateClearEnabled();
    this.redrawPending();
    this.updateProveEnabled();
  }

  private clearPending(): void {
    if (this.proposalRequest) return;
    this.pending = undefined;
    this.pendingExtendTiles = 0;
    this.pendingRemoveId = undefined;
    this.updateClearEnabled();
    this.toolbar.hideMessage();
    this.redrawBase();
    this.redrawPending();
    this.redrawExtension();
    this.updateProveEnabled();
  }

  // Clear undoes either add-on (Extend Level or a marked-for-removal
  // platform) as well as the pending object itself, so it has to stay
  // enabled whenever any one of the three is set, not just `pending` alone.
  private updateClearEnabled(): void {
    this.toolbar.setClearEnabled(
      this.pending !== undefined || this.pendingRemoveId !== undefined
    );
  }

  private onBoardTileTap(
    _tap: unknown,
    tileXY: { x: number; y: number }
  ): void {
    if (this.panZoom.shouldIgnoreTap()) return;
    if (this.proposalRequest || !this.baseLevel) return;
    const row = normalizeBoardRow(tileXY.y);
    const world = this.board.tileXYToWorldXY(tileXY.x, row);

    // Checked before the "choose a type first" gate below — removing a
    // platform is its own action, independent of what (if anything) the
    // player has picked to place, same as Extend Level needs no selected
    // type either.
    const removable = this.removablePlatformAt(world.x, world.y);
    if (removable) {
      this.toggleRemoveTarget(removable);
      return;
    }

    if (!this.selectedType) {
      this.toolbar.showMessage('Choose a curse type first.');
      return;
    }

    if (this.isOccupiedByBase(world.x, world.y, this.selectedType)) {
      this.toolbar.showMessage(
        'Something is already there — try another spot.'
      );
      return;
    }

    this.toolbar.hideMessage();
    this.growExtensionToReach(world.x);
    this.setPendingAt(world.x, world.y);
  }

  private removablePlatformAt(x: number, y: number): LevelObject | undefined {
    return (this.baseLevel?.objects ?? []).find(
      (o) => REMOVABLE_PLATFORM_TYPES.has(o.type) && o.x === x && o.y === y
    );
  }

  // Marking a platform for removal frees up its cell — the player can then
  // place their curse object right where it was, which is often the whole
  // point (open up a gap, then put a hazard in it) — so this cell is
  // excluded from `some` below whenever it's the current removal target.
  // Only an object on the same placement layer blocks the cell (see
  // isSurfaceType): a hazard can sit on a ground or platform tile.
  private isOccupiedByBase(x: number, y: number, type: ObjectType): boolean {
    if (
      (this.baseLevel?.objects ?? []).some(
        (o) =>
          o.id !== this.pendingRemoveId &&
          isSurfaceType(o.type) === isSurfaceType(type) &&
          o.x === x &&
          o.y === y
      )
    ) {
      return true;
    }
    const extension = this.currentExtension();
    return (
      extension !== undefined && extension.finish.x === x && extension.finish.y === y
    );
  }

  // Tapping the same marked platform again un-marks it; tapping a
  // different removable object switches the target — only one removal is
  // ever pending, same "exactly one add-on" scope as pendingExtendTiles.
  private toggleRemoveTarget(object: LevelObject): void {
    if (this.proposalRequest) return;
    if (this.pendingRemoveId === object.id) {
      this.pendingRemoveId = undefined;
      this.toolbar.hideMessage();
    } else {
      this.pendingRemoveId = object.id;
      this.toolbar.showMessage(
        "Platform marked for removal — now place a curse, then prove it's possible."
      );
    }
    this.updateClearEnabled();
    this.redrawBase();
    this.updateProveEnabled();
  }

  // The Remove button (only visible under the Platform category, next to
  // its type tiles) doesn't itself know which platform to remove — that's
  // picked by tapping one directly (toggleRemoveTarget, which already
  // works regardless of category/type selection) — so this only points the
  // player at that gesture rather than performing a removal on its own.
  private showRemoveHint(): void {
    if (this.proposalRequest) return;
    this.toolbar.showMessage(
      'Tap an existing platform on the board to mark it for removal.'
    );
  }

  private updateProveEnabled(): void {
    const ready =
      !this.proposalRequest &&
      this.baseLevel !== undefined &&
      this.pending !== undefined &&
      !this.isOccupiedByBase(this.pending.x, this.pending.y, this.pending.type);
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

  // The explicit "Extend Level" button — one click maxes the level out to
  // its full allowed width (see maxExtendableTiles), not a re-tappable
  // small chunk, so extending only ever takes one click. A second click
  // (or one on an already-maxed level) is a correctly-detected no-op —
  // maxExtendableTiles is measured from the original base, same reference
  // frame pendingExtendTiles already uses everywhere else.
  private extendLevel(): void {
    if (this.proposalRequest || !this.baseLevel) return;
    const max = maxExtendableTiles(this.baseObjectsAsDraft());
    if (max <= this.pendingExtendTiles) {
      this.toolbar.showMessage('Level is already at the maximum length.');
      return;
    }
    this.pendingExtendTiles = max;
    this.toolbar.showMessage(
      "Level extended — now place a curse, then prove it's possible."
    );
    this.redrawBase();
    this.redrawExtension();
    this.updateProveEnabled();
  }

  // Hides the base level's own finish while an extension is pending — it's
  // being relocated, and redrawExtension() renders the new one in its
  // place — so the player never sees two finish portals at once.
  private redrawBase(): void {
    for (const tween of this.baseMotionTweens) {
      tween.stop();
    }
    this.baseMotionTweens = [];
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
        if (object.id === this.pendingRemoveId) {
          // Same red as the pending-object outline (drawPendingOutline) —
          // one "this is about to change" color across the scene.
          image.setTint(0xff3966);
          image.setAlpha(0.45);
        }
        this.baseImages.push(image);
        const tweenConfig = motionTweenConfigFor(image, object);
        if (tweenConfig) {
          this.baseMotionTweens.push(this.tweens.add(tweenConfig));
        }
      }
    }
  }

  private redrawExtension(): void {
    for (const tween of this.extensionMotionTweens) {
      tween.stop();
    }
    this.extensionMotionTweens = [];
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
        // Ground/finish tiles never move — this only ever actually starts a
        // tween on some future extension tile type that does, if one's ever
        // added to the palette.
        const tweenConfig = motionTweenConfigFor(image, previewObject);
        if (tweenConfig) {
          this.extensionMotionTweens.push(this.tweens.add(tweenConfig));
        }
      }
    }
  }

  private redrawPending(): void {
    this.pendingGraphics.clear();
    this.pendingMotionTween?.stop();
    this.pendingMotionTween = undefined;
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
      const tweenConfig = motionTweenConfigFor(image, previewObject);
      if (tweenConfig) {
        this.pendingMotionTween = this.tweens.add(tweenConfig);
      }
      image.on('pointerdown', () => {
        this.panZoom.setSuspended(true);
        // Paused, not stopped — a tap that never crosses the drag threshold
        // fires 'pointerup' with no 'drag'/'dragend' at all, so this has to
        // resume from wherever it left off rather than relying on dragend's
        // redrawPending to build a fresh one.
        this.pendingMotionTween?.pause();
      });
      image.on('pointerup', () => this.pendingMotionTween?.resume());
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

    if (this.isOccupiedByBase(snapped.x, snapped.y, this.selectedType)) {
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
    const removeObjectId = this.pendingRemoveId;
    const requestId = {};
    this.proposalRequest = requestId;
    this.toolbar.setEditingEnabled(false);
    this.updateProveEnabled();
    this.toolbar.showMessage('Checking your curse...');
    try {
      const request: ProposeCurseRequest = {
        levelId,
        object: pending,
        ...(extendByTiles > 0 ? { extendByTiles } : {}),
        ...(removeObjectId ? { removeObjectId } : {}),
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
          removeObjectId,
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
