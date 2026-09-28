import * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';
import { HAZARD_TINT } from '../constants';

// Per-hazard death animations in the notebook style: what killed the player
// decides how they die, so a gear death reads differently from a charger
// death at a glance. Each works from a stand-in copy of the player's
// current pose (never the live physics sprite — Player.die() hides that,
// and mutating a physics sprite's x/y for cosmetics corrupts its body; see
// Arcade's preUpdate resync). Scale and position only, never rotation (a
// rotated pose drops texture chunks). Every piece self-destroys.
//
// `x`/`y` are the player sprite's bottom-center (its origin, see Player.ts)
// and `displaySize` its on-screen square size.
type DeathEffect = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
) => void;

// Scribble art from Kenney's Scribble Platformer (Preloader loads these).
export const SCRIBBLE_FX = [
  { key: 'scribble-blast', file: 'vfx/scribble-blast.webp' },
  { key: 'scribble-blast-large', file: 'vfx/scribble-blast-large.webp' },
  { key: 'scribble-x', file: 'vfx/scribble-x.webp' },
] as const;

const INK = 0x2b2b2b;
const DANGER = HAZARD_TINT ?? 0xe53935;

// A copy of the player's current pose laid exactly over the real sprite.
function playerStandIn(
  scene: Phaser.Scene,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): Phaser.GameObjects.Image {
  const image = scene.add.image(x, y, textureKey);
  image.setOrigin(0.5, 1);
  image.setDisplaySize(displaySize, displaySize);
  return image;
}

// A doodled blast that pops in and fades, centered on (x, y).
function blast(scene: Phaser.Scene, x: number, y: number, size: number, tint: number, large = true): void {
  const image = scene.add.image(x, y, large ? 'scribble-blast-large' : 'scribble-blast');
  image.setTint(tint).setDepth(5);
  const scale = size / image.height;
  image.setScale(scale * 0.3);
  scene.tweens.add({
    targets: image,
    scale,
    duration: 140,
    ease: 'Back.easeOut',
    onComplete: () =>
      scene.tweens.add({ targets: image, alpha: 0, duration: 260, delay: 120, onComplete: () => image.destroy() }),
  });
}

// The pencil-drawn ✗ left where the player died, for a beat.
function crossOut(scene: Phaser.Scene, x: number, y: number, size: number, tint: number): void {
  const mark = scene.add.image(x, y, 'scribble-x').setTint(tint).setDepth(6);
  const scale = size / mark.height;
  mark.setScale(scale * 1.6).setAlpha(0);
  scene.tweens.add({
    targets: mark,
    scale,
    alpha: 1,
    duration: 120,
    ease: 'Quad.easeOut',
    onComplete: () =>
      scene.tweens.add({ targets: mark, alpha: 0, duration: 300, delay: 260, onComplete: () => mark.destroy() }),
  });
}

// Gear: flattened like a sheet through a shredder, then an ink blast.
const gearShred: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  const sx = body.scaleX;
  const sy = body.scaleY;
  scene.tweens.add({
    targets: body,
    scaleY: sy * 0.15,
    scaleX: sx * 1.35,
    alpha: 0,
    duration: 260,
    ease: 'Quad.easeIn',
    onComplete: () => body.destroy(),
  });
  blast(scene, x, y - displaySize * 0.4, displaySize * 1.1, DANGER);
  crossOut(scene, x, y - displaySize * 0.5, displaySize * 0.6, DANGER);
  scene.cameras.main.shake(120, 0.006);
};

// Spikes: poked up into the air, then dropped off the page.
const spikesPoke: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: y - 70, duration: 180, ease: 'Quad.easeOut' },
      { y: y + 260, alpha: 0, duration: 420, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
  blast(scene, x, y - 10, displaySize * 0.6, DANGER, false);
  crossOut(scene, x, y - displaySize * 0.5, displaySize * 0.6, DANGER);
};

// Charger: bonked backwards off the line.
const chargerBonk: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { x: x - 60, y: y - 50, duration: 200, ease: 'Quad.easeOut' },
      { x: x - 110, y: y + 240, alpha: 0, duration: 420, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
  blast(scene, x + displaySize / 3, y - displaySize / 2, displaySize * 0.7, DANGER, false);
  crossOut(scene, x, y - displaySize * 0.5, displaySize * 0.6, DANGER);
  scene.cameras.main.shake(100, 0.005);
};

// Floater: erased — the pencil fades and shrinks into nothing.
const floaterErase: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  scene.tweens.add({
    targets: body,
    scaleX: body.scaleX * 0.2,
    scaleY: body.scaleY * 0.2,
    y: y - displaySize * 0.4,
    alpha: 0,
    duration: 520,
    ease: 'Quad.easeIn',
    onComplete: () => body.destroy(),
  });
  blast(scene, x, y - displaySize * 0.5, displaySize * 0.8, INK, false);
  crossOut(scene, x, y - displaySize * 0.5, displaySize * 0.6, DANGER);
};

// Falls and anything without its own entry: scribbled out on the spot.
const scribbleOut: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  scene.tweens.add({ targets: body, alpha: 0, duration: 360, onComplete: () => body.destroy() });
  blast(scene, x, y - displaySize * 0.4, displaySize * 1.2, INK);
  crossOut(scene, x, y - displaySize * 0.5, displaySize * 0.7, INK);
  scene.cameras.main.shake(120, 0.006);
};

const DEATH_EFFECT_BY_TYPE: Partial<Record<ObjectType, DeathEffect>> = {
  saw: gearShred,
  movingSaw: gearShred,
  candle: spikesPoke,
  bat: chargerBonk,
  ghost: floaterErase,
};

export function playDeathEffect(
  scene: Phaser.Scene,
  killer: ObjectType | undefined,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): void {
  const effect = (killer && DEATH_EFFECT_BY_TYPE[killer]) ?? scribbleOut;
  effect(scene, x, y, textureKey, displaySize);
}
