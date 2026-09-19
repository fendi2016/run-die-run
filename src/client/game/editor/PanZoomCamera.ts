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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly toolbarElementId: string,
    // Called after every zoom/pan change, e.g. to redraw a grid overlay
    // that tracks the camera's current scroll/zoom.
    private readonly onChange: () => void
  ) {}

  attach(): void {
    this.applyResponsiveZoom();
    this.scene.scale.on('resize', this.applyResponsiveZoom, this);
    this.scene.input.on('pointerdown', this.onPointerDown, this);
    this.scene.input.on('pointermove', this.onPointerMove, this);
    this.scene.input.on('pointerup', this.onPointerUp, this);
  }

  detach(): void {
    this.scene.scale.off('resize', this.applyResponsiveZoom, this);
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
  }

  applyResponsiveZoom = (): void => {
    const toolbarHeight = this.measureToolbarHeightPx();
    const viewportHeight = Math.max(
      1,
      this.scene.scale.height - toolbarHeight
    );
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
    this.scene.cameras.main.scrollX = Phaser.Math.Clamp(
      this.scene.cameras.main.scrollX + deltaPx,
      0,
      this.maxScrollX()
    );
    this.onChange();
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    this.pointerDownAt = { x: pointer.x, y: pointer.y };
    this.dragStartScrollX = this.scene.cameras.main.scrollX;
    this.isDragging = false;
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!pointer.isDown || !this.pointerDownAt) {
      return;
    }
    const dx = pointer.x - this.pointerDownAt.x;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX) {
      this.isDragging = true;
    }
    if (this.isDragging) {
      this.scene.cameras.main.scrollX = Phaser.Math.Clamp(
        this.dragStartScrollX - dx / this.scene.cameras.main.zoom,
        0,
        this.maxScrollX()
      );
      this.onChange();
    }
  };

  private onPointerUp = (): void => {
    this.pointerDownAt = undefined;
    this.isDragging = false;
  };
}
