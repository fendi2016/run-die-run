import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT } from '../../../shared/constants';
import { levelWidthPx } from './GridSystem';

// Both EditorScene and CurseScene lock the camera's vertical zoom to
// LOGICAL_HEIGHT within a viewport shrunk by their bottom DOM toolbar's
// real rendered height (a hidden toolbar measures 0px tall, so
// `attach()` must run after the toolbar is shown), and support panning
// both by button and by drag. Extracted after the two scenes drifted
// into ~55 lines of byte-identical logic — differing only in which
// toolbar element id to measure — so a future fix to one wouldn't
// silently fail to reach the other.
const DRAG_THRESHOLD_PX = 4;
export const PAN_STEP_PX = 240;

export class PanZoomCamera {
  private pointerDownAt: { x: number; y: number } | undefined;
  private dragStartScrollX = 0;
  private isDragging = false;
  // Set while a draggable placed object (CurseScene's pending preview) owns
  // the pointer — without this, dragging that object also reads as a
  // camera-pan drag on the same pointer, fighting it frame to frame since
  // one moves the object in world space while the other changes what world
  // space maps to which screen pixel.
  private suspended = false;
  private targetScrollX = 0;
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
    this.applyResponsiveZoom();
    this.targetScrollX = this.scene.cameras.main.scrollX;
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
    this.scene.cameras.main.setZoom(viewportHeight / LOGICAL_HEIGHT);
    this.onChange();
  };

  private measureToolbarHeightPx(): number {
    const toolbar = document.getElementById(this.toolbarElementId);
    return toolbar ? toolbar.getBoundingClientRect().height : 0;
  }

  private maxScrollX(): number {
    const visibleWorldWidth =
      this.scene.scale.width / this.scene.cameras.main.zoom;
    return Math.max(0, levelWidthPx() - visibleWorldWidth);
  }

  panBy(deltaPx: number): void {
    this.velocityX = 0;
    this.targetScrollX = Phaser.Math.Clamp(
      this.targetScrollX + deltaPx,
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
    const camera = this.scene.cameras.main;
    if (this.velocityX !== 0) {
      // Integrate exponential friction so 60 Hz and 120 Hz coast equally far.
      const decay = Math.exp(-Math.min(delta, 64) / 240);
      const next = camera.scrollX + this.velocityX * 240 * (1 - decay);
      camera.scrollX = Phaser.Math.Clamp(next, 0, this.maxScrollX());
      this.velocityX *= decay;
      if (
        next !== camera.scrollX ||
        Math.abs(this.velocityX * camera.zoom) < 0.015
      ) {
        this.velocityX = 0;
      }
      this.targetScrollX = camera.scrollX;
      this.onChange();
      return;
    }
    this.targetScrollX = Phaser.Math.Clamp(
      this.targetScrollX,
      0,
      this.maxScrollX()
    );
    const remaining = this.targetScrollX - camera.scrollX;
    if (remaining === 0) return;
    camera.scrollX =
      Math.abs(remaining) < 0.1
        ? this.targetScrollX
        : camera.scrollX + remaining * (1 - Math.exp(-delta / 65));
    this.onChange();
  };

  // Called by a scene while it's dragging a placed object itself, so this
  // class's own drag-to-pan gesture recognition doesn't run against the
  // same pointer at the same time.
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.velocityX = 0;
    this.targetScrollX = this.scene.cameras.main.scrollX;
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
    this.dragStartScrollX = this.scene.cameras.main.scrollX;
    this.targetScrollX = this.dragStartScrollX;
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
      const previousScroll = this.scene.cameras.main.scrollX;
      this.scene.cameras.main.scrollX = Phaser.Math.Clamp(
        this.dragStartScrollX - dx / this.scene.cameras.main.zoom,
        0,
        this.maxScrollX()
      );
      const elapsed = Math.max(1, now - this.lastMoveAt);
      const sample =
        (this.scene.cameras.main.scrollX - previousScroll) / elapsed;
      this.velocityX +=
        (sample - this.velocityX) * (1 - Math.exp(-elapsed / 35));
      this.lastMoveAt = now;
      this.targetScrollX = this.scene.cameras.main.scrollX;
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
