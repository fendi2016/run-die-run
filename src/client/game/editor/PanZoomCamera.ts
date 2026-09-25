import * as Phaser from 'phaser';
import { GRID_CELL_SIZE } from '../../../shared/constants';
import {
  gridViewBottomY,
  gridViewHeightPx,
  gridViewTopY,
  levelWidthPx,
} from './GridSystem';

// Both EditorScene and CurseScene lock the camera's vertical zoom to fit
// the editable grid within a viewport shrunk by their bottom DOM toolbar's
// real rendered height (a hidden toolbar measures 0px tall, so
// `attach()` must run after the toolbar is shown), and support panning
// both by button and by drag. Extracted after the two scenes drifted
// into ~55 lines of byte-identical logic — differing only in which
// toolbar element id to measure — so a future fix to one wouldn't
// silently fail to reach the other.
//
// Phaser's camera.scrollX/scrollY are NOT "world coordinate at the
// viewport's top-left corner" once zoom != 1 — zoom pivots around the
// viewport's center, and scrollX/Y instead satisfy
// `scroll = worldCenter - viewportSizeInPixels / 2` (confirmed empirically
// by rendering calibration lines at known world coordinates and reading
// back actual pixel positions; a naive `scrollY = desiredTopWorldY` left
// content floating a third of the way down the screen, and the same
// mistake on X left a large dead gap at the left edge with grid columns
// "cut off"/missing instead of reaching it — worse the further zoom sits
// from 1, so it only became obvious on narrower/taller mobile aspect
// ratios). `centerOnX`/`centerOnY` do this conversion correctly, so
// every place that used to assign scrollX/Y directly goes through the
// left-edge-world-X helpers below instead, and every place that reads
// "what world X is at the screen edge right now" uses
// `visibleWorldRangeX()` — never `camera.scrollX` or `camera.worldView`
// directly (the latter is matrix-cached and can be a frame stale
// immediately after a same-tick zoom/scroll change).
const DRAG_THRESHOLD_PX = 4;
export const PAN_STEP_PX = 240;
const TRAILING_OVERHANG_PX = GRID_CELL_SIZE * 3;

export class PanZoomCamera {
  private pointerDownAt: { x: number; y: number } | undefined;
  // World X that should sit at the viewport's left edge — the pan/inertia
  // state lives in this "desired left edge" space throughout, and only
  // ever touches the camera through setLeftEdgeWorldX/currentLeftEdgeWorldX.
  private dragStartLeftEdgeX = 0;
  private isDragging = false;
  // Set while a draggable placed object (CurseScene's pending preview) owns
  // the pointer — without this, dragging that object also reads as a
  // camera-pan drag on the same pointer, fighting it frame to frame since
  // one moves the object in world space while the other changes what world
  // space maps to which screen pixel.
  private suspended = false;
  private targetLeftEdgeX = 0;
  private velocityX = 0;
  private lastMoveAt = 0;
  private activePointerId: number | undefined;
  private ignoreTapUntil = 0;
  private previousTouchAction = '';

  shouldIgnoreTap(): boolean {
    return this.isDragging || performance.now() < this.ignoreTapUntil;
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly toolbarElementId: string,
    // Called after every zoom/pan change, e.g. to redraw a grid overlay
    // that tracks the camera's current scroll/zoom.
    private readonly onChange: () => void
  ) {}

  attach(): void {
    this.previousTouchAction = this.scene.game.canvas.style.touchAction;
    this.scene.game.canvas.style.touchAction = 'none';
    // targetLeftEdgeX defaults to 0 (the level's left edge) — applied by
    // applyResponsiveZoom below.
    this.applyResponsiveZoom();
    this.scene.events.on('update', this.update, this);
    this.scene.game.canvas.addEventListener('wheel', this.onWheel, {
      passive: false,
    });
    this.scene.scale.on('resize', this.applyResponsiveZoom, this);
    this.scene.input.on('pointerdown', this.onPointerDown, this);
    this.scene.input.on('pointermove', this.onPointerMove, this);
    this.scene.input.on('pointerup', this.onPointerUp, this);
    // Safety net for a lost dragend on whatever set suspended=true (the
    // dragged object got destroyed by a redraw mid-drag, or its dragend
    // just never fires) — these fire on the pointer itself, independent of
    // whichever GameObject it was interacting with, so they still catch a
    // release even once that object is gone.
    this.scene.input.on('pointerup', this.clearSuspended, this);
    this.scene.input.on('gameout', this.onPointerUp, this);
    this.scene.input.on('gameout', this.clearSuspended, this);
    this.scene.input.on('pointerupoutside', this.onPointerUp, this);
    this.scene.input.on('pointerupoutside', this.clearSuspended, this);
  }

  detach(): void {
    this.scene.game.canvas.style.touchAction = this.previousTouchAction;
    this.scene.events.off('update', this.update, this);
    this.scene.game.canvas.removeEventListener('wheel', this.onWheel);
    this.scene.scale.off('resize', this.applyResponsiveZoom, this);
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerup', this.clearSuspended, this);
    this.scene.input.off('gameout', this.onPointerUp, this);
    this.scene.input.off('gameout', this.clearSuspended, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.clearSuspended, this);
  }

  applyResponsiveZoom = (): void => {
    const toolbarHeight = this.measureToolbarHeightPx();
    const viewportHeight = Math.max(1, this.scene.scale.height - toolbarHeight);
    this.scene.cameras.main.setViewport(
      0,
      0,
      this.scene.scale.width,
      viewportHeight
    );
    // Fit the grid's own content height (not GameScene's sky-inclusive
    // LOGICAL_HEIGHT) so the whole viewport above the toolbar is filled
    // with actual placeable grid instead of leaving a dead band above it.
    const zoom = viewportHeight / gridViewHeightPx();
    this.scene.cameras.main.setZoom(zoom);
    this.scene.cameras.main.centerOnY(
      (gridViewTopY() + gridViewBottomY()) / 2
    );
    // zoom changed, so the world width now visible at the current pan
    // position changed too — reassert the left edge rather than leaving
    // scrollX at whatever raw value it had for the old zoom.
    this.setLeftEdgeWorldX(this.targetLeftEdgeX);
    this.onChange();
  };

  private measureToolbarHeightPx(): number {
    const toolbar = document.getElementById(this.toolbarElementId);
    return toolbar ? toolbar.getBoundingClientRect().height : 0;
  }

  private visibleWorldWidth(): number {
    const cam = this.scene.cameras.main;
    return cam.width / cam.zoom;
  }

  // The world X actually at the left edge of the viewport right now. Reads
  // only plain scrollX/zoom/width properties (always synchronously
  // current) rather than the matrix-derived camera.worldView.
  private currentLeftEdgeWorldX(): number {
    const cam = this.scene.cameras.main;
    return cam.scrollX + cam.width / 2 - this.visibleWorldWidth() / 2;
  }

  private setLeftEdgeWorldX(leftEdgeX: number): void {
    this.scene.cameras.main.centerOnX(leftEdgeX + this.visibleWorldWidth() / 2);
  }

  // The true visible world-X range, for grid-line-culling redraws — see
  // the class-level comment for why this isn't camera.worldView.
  visibleWorldRangeX(): { left: number; right: number } {
    const left = this.currentLeftEdgeWorldX();
    return { left, right: left + this.visibleWorldWidth() };
  }

  // The finish flag is wider than one cell and overhangs its own tile, so
  // with the camera clamped to the grid's last column a finish placed
  // there was cut off. Panning may run this far past the level's end
  // (empty, gridless space) so the whole flag shows.
  private maxScrollX(): number {
    return Math.max(
      0,
      levelWidthPx() + TRAILING_OVERHANG_PX - this.visibleWorldWidth()
    );
  }

  panBy(deltaPx: number): void {
    this.velocityX = 0;
    this.targetLeftEdgeX = Phaser.Math.Clamp(
      this.targetLeftEdgeX + deltaPx,
      0,
      this.maxScrollX()
    );
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.suspended || event.ctrlKey) return;
    event.preventDefault();
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? this.scene.scale.width
          : 1;
    this.panBy((delta * unit) / this.scene.cameras.main.zoom);
  };

  private update = (_time: number, delta: number): void => {
    if (this.isDragging || this.suspended) return;
    if (this.velocityX !== 0) {
      // Integrate exponential friction so 60 Hz and 120 Hz coast equally far.
      const decay = Math.exp(-Math.min(delta, 64) / 240);
      const current = this.currentLeftEdgeWorldX();
      const next = current + this.velocityX * 240 * (1 - decay);
      const clamped = Phaser.Math.Clamp(next, 0, this.maxScrollX());
      this.setLeftEdgeWorldX(clamped);
      this.velocityX *= decay;
      if (
        next !== clamped ||
        Math.abs(this.velocityX * this.scene.cameras.main.zoom) < 0.015
      ) {
        this.velocityX = 0;
      }
      this.targetLeftEdgeX = clamped;
      this.onChange();
      return;
    }
    this.targetLeftEdgeX = Phaser.Math.Clamp(
      this.targetLeftEdgeX,
      0,
      this.maxScrollX()
    );
    const current = this.currentLeftEdgeWorldX();
    const remaining = this.targetLeftEdgeX - current;
    if (remaining === 0) return;
    const next =
      Math.abs(remaining) < 0.1
        ? this.targetLeftEdgeX
        : current + remaining * (1 - Math.exp(-delta / 65));
    this.setLeftEdgeWorldX(next);
    this.onChange();
  };

  // Called by a scene while it's dragging a placed object itself, so this
  // class's own drag-to-pan gesture recognition doesn't run against the
  // same pointer at the same time.
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.velocityX = 0;
    this.targetLeftEdgeX = this.currentLeftEdgeWorldX();
    if (suspended) {
      this.activePointerId = undefined;
      this.pointerDownAt = undefined;
      this.isDragging = false;
    }
  }

  private clearSuspended = (): void => {
    this.suspended = false;
  };

  private onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.suspended || this.activePointerId !== undefined) {
      return;
    }
    if (Math.abs(this.velocityX) > 0)
      this.ignoreTapUntil = performance.now() + 250;
    this.velocityX = 0;
    this.activePointerId = pointer.id;
    this.lastMoveAt = performance.now();
    this.pointerDownAt = { x: pointer.x, y: pointer.y };
    this.dragStartLeftEdgeX = this.currentLeftEdgeWorldX();
    this.targetLeftEdgeX = this.dragStartLeftEdgeX;
    this.isDragging = false;
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (
      this.suspended ||
      pointer.id !== this.activePointerId ||
      !pointer.isDown ||
      !this.pointerDownAt
    ) {
      return;
    }
    const dx = pointer.x - this.pointerDownAt.x;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX) {
      this.isDragging = true;
    }
    if (this.isDragging) {
      const now = performance.now();
      const previousLeftEdge = this.currentLeftEdgeWorldX();
      const nextLeftEdge = Phaser.Math.Clamp(
        this.dragStartLeftEdgeX - dx / this.scene.cameras.main.zoom,
        0,
        this.maxScrollX()
      );
      this.setLeftEdgeWorldX(nextLeftEdge);
      const elapsed = Math.max(1, now - this.lastMoveAt);
      const sample = (nextLeftEdge - previousLeftEdge) / elapsed;
      this.velocityX +=
        (sample - this.velocityX) * (1 - Math.exp(-elapsed / 35));
      this.lastMoveAt = now;
      this.targetLeftEdgeX = nextLeftEdge;
      this.onChange();
    }
  };

  private onPointerUp = (pointer?: Phaser.Input.Pointer): void => {
    if (pointer && pointer.id !== this.activePointerId) return;
    const now = performance.now();
    if (this.isDragging) this.ignoreTapUntil = now + 250;
    if (!this.isDragging || now - this.lastMoveAt > 80) this.velocityX = 0;
    this.activePointerId = undefined;
    this.pointerDownAt = undefined;
    this.isDragging = false;
  };
}
