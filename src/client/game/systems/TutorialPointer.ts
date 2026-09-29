import * as Phaser from 'phaser';
import type { LevelObject, ObjectType } from '../../../shared/types';
import {
  CANDLE_DISPLAY_HEIGHT_PX,
  FINISH_DISPLAY_HEIGHT_PX,
  GHOST_DISPLAY_HEIGHT_PX,
} from '../constants';

// Points the Kenney scribble hand (ui_hand) at whichever obstacle the
// tutorial's current hint is about. Cosmetic only — a plain Image with no
// input handler of its own registered on it, so it never intercepts a tap
// that should reach the canvas as a jump (same constraint TutorialHint's
// own comment calls out). Lives in world space, not a DOM overlay, so it
// scrolls with the level exactly like the hazard it's pointing at.
const POINTER_TEXTURE = 'ui-hand';
// The source art's finger points right — toward positive x — which is also
// the direction the player runs, so no rotation is needed: the hand sits
// just left of the target with its fingertip toward it, matching the run
// direction instead of fighting it.
const POINTER_ORIGIN_X = 0.85;
const POINTER_ORIGIN_Y = 0.4;
const DISPLAY_HEIGHT_PX = 46;
const HOVER_GAP_PX = 28;
const BOB_AMPLITUDE_PX = 6;
const BOB_PERIOD_MS = 650;
const POINTER_DEPTH = 1000;

// Every hazard sprite is bottom-anchored at its authored y (see
// ObjectRegistry.originFor) — half of each type's own display height, so
// the pointer's fingertip lands near the target's vertical middle instead
// of down at its feet. Kept in sync by hand with ObjectRegistry's own
// per-type display heights (a handful of types, not worth importing the
// whole render path for one offset each).
const TARGET_MID_HEIGHT_PX: Partial<Record<ObjectType, number>> = {
  candle: CANDLE_DISPLAY_HEIGHT_PX / 2,
  ghost: GHOST_DISPLAY_HEIGHT_PX / 2,
  finish: FINISH_DISPLAY_HEIGHT_PX / 2,
};

export class TutorialPointer {
  private readonly image: Phaser.GameObjects.Image;
  private readonly bob = { offset: 0 };
  private readonly bobTween: Phaser.Tweens.Tween;
  private currentTargetId: string | undefined;
  private baseX = 0;
  private baseY = 0;

  constructor(scene: Phaser.Scene) {
    this.image = scene.add
      .image(0, 0, POINTER_TEXTURE)
      .setOrigin(POINTER_ORIGIN_X, POINTER_ORIGIN_Y)
      .setDepth(POINTER_DEPTH)
      .setVisible(false);
    const aspect = this.image.width / this.image.height;
    this.image.setDisplaySize(DISPLAY_HEIGHT_PX * aspect, DISPLAY_HEIGHT_PX);
    this.bobTween = scene.tweens.add({
      targets: this.bob,
      offset: BOB_AMPLITUDE_PX,
      duration: BOB_PERIOD_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      onUpdate: () => this.applyPosition(),
    });
    this.bobTween.pause();
    scene.events.once('shutdown', () => this.destroy());
  }

  // `target` is the tutorial's current hint-linked LevelObject — undefined
  // when the hint has nothing to point at (e.g. the gap-jump hint, which
  // spans open ground) or the player hasn't reached a pointed-at hint yet.
  show(target: LevelObject | undefined): void {
    if (!target) {
      this.hide();
      return;
    }
    if (target.id === this.currentTargetId) {
      return;
    }
    this.currentTargetId = target.id;
    const midHeight = TARGET_MID_HEIGHT_PX[target.type] ?? 0;
    this.baseX = target.x - HOVER_GAP_PX;
    this.baseY = target.y - midHeight;
    this.image.setVisible(true);
    this.applyPosition();
    this.bobTween.restart();
  }

  hide(): void {
    if (this.currentTargetId === undefined) return;
    this.currentTargetId = undefined;
    this.image.setVisible(false);
    this.bobTween.pause();
  }

  private applyPosition(): void {
    this.image.setPosition(this.baseX, this.baseY - this.bob.offset);
  }

  destroy(): void {
    this.bobTween.stop();
    this.image.destroy();
  }
}
