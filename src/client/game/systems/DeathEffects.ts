import * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';
import {
  burstParticles,
  playBloodSplatter,
  playDeathExplosion,
  playPlayerShatter,
  slicePlayerFrame,
} from './Juice';

// Per-hazard death VFX: what killed the player decides how they die, so a
// saw death reads differently from a ghost death at a glance. Each effect
// works from a stand-in copy of the player's current pose (never the live
// physics sprite — Player.die() hides that, and mutating a physics sprite's
// x/y for cosmetics corrupts its body; see Arcade's preUpdate resync). All
// pieces are one-shot and self-destroying, like the rest of Juice.
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

const SAW_SPARK_COLOR = 0xffd23f;
const SAW_GORE_COLOR = 0xe0303a;
// 64px source frames -> ~128px burst, a bit wider than the 80px player.
const SAW_SPLATTER_SCALE = 2;

// Sliced clean through at the waist: the top half is flung up and back,
// spinning, while the legs stagger a beat and topple — with a spray of
// metal sparks and a burst of blood where the blade went through.
const sawSlice: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const pieces = slicePlayerFrame(scene, x, y, textureKey, displaySize, 1, 2);
  const cutY = y - displaySize / 2;
  for (const { piece, row } of pieces) {
    if (row === 0) {
      scene.tweens.add({
        targets: piece,
        x: piece.x - 70,
        angle: -300,
        duration: 520,
        ease: 'Quad.easeOut',
      });
      scene.tweens.chain({
        targets: piece,
        tweens: [
          { y: piece.y - 70, duration: 200, ease: 'Quad.easeOut' },
          { y: piece.y + 90, alpha: 0, duration: 320, ease: 'Quad.easeIn' },
        ],
        onComplete: () => piece.destroy(),
      });
    } else {
      scene.tweens.chain({
        targets: piece,
        tweens: [
          { x: piece.x + 4, duration: 60, yoyo: true, repeat: 1 },
          { angle: 80, x: piece.x + 14, y: piece.y + 8, duration: 260, ease: 'Quad.easeIn' },
          { alpha: 0, duration: 180 },
        ],
        onComplete: () => piece.destroy(),
      });
    }
  }
  burstParticles(scene, x, cutY, SAW_SPARK_COLOR, 18);
  burstParticles(scene, x, cutY, SAW_GORE_COLOR, 22);
  playBloodSplatter(scene, x, cutY, SAW_SPLATTER_SCALE);
  scene.cameras.main.shake(140, 0.008);
};

const CHAR_TINT = 0x1c1414;
const EMBER_COLOR = 0xff8a2a;
const ASH_GRID = 4;
const CANDLE_CHAR_MS = 220;

// Burned to a crisp: the player flash-chars black and trembles for a beat,
// then crumbles into ash that drops to the floor, embers rising off it.
const candleBurn: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setTint(0xff6a1a).setTintMode(Phaser.TintModes.FILL);
  scene.time.delayedCall(60, () => body.setTint(CHAR_TINT).setTintMode(Phaser.TintModes.MULTIPLY));
  scene.tweens.add({ targets: body, x: x + 2, duration: 40, yoyo: true, repeat: 2 });
  burstParticles(scene, x, y - displaySize / 2, EMBER_COLOR, 16);
  scene.cameras.main.shake(90, 0.004);

  scene.time.delayedCall(CANDLE_CHAR_MS, () => {
    scene.tweens.killTweensOf(body);
    body.destroy();
    for (const { piece, row } of slicePlayerFrame(scene, x, y, textureKey, displaySize, ASH_GRID, ASH_GRID)) {
      piece.setTint(CHAR_TINT);
      // Higher rows have further to fall, so they land a touch later.
      scene.tweens.add({
        targets: piece,
        x: piece.x + Phaser.Math.Between(-18, 18),
        y: y - Phaser.Math.Between(0, 6),
        angle: Phaser.Math.Between(-90, 90),
        scale: piece.scale * 0.6,
        alpha: 0,
        delay: (ASH_GRID - 1 - row) * 25 + Phaser.Math.Between(0, 40),
        duration: 360 + (ASH_GRID - 1 - row) * 40,
        ease: 'Quad.easeIn',
        onComplete: () => piece.destroy(),
      });
    }
    burstParticles(scene, x, y - 10, EMBER_COLOR, 12);
  });
};

const BAT_HIT_COLOR = 0xffffff;

// Rammed out of the level: a white impact flash, then the player is sent
// cartwheeling back the way they came (bats dash in at the player from
// ahead) in a cartoon arc that drops off-screen.
const batKnockout: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setOrigin(0.5, 0.5);
  body.setY(y - displaySize / 2);
  body.setTint(BAT_HIT_COLOR).setTintMode(Phaser.TintModes.FILL);
  scene.time.delayedCall(70, () => body.clearTint());
  burstParticles(scene, x + displaySize / 3, y - displaySize / 2, BAT_HIT_COLOR, 16);
  scene.cameras.main.shake(110, 0.007);

  scene.tweens.add({
    targets: body,
    x: x - 220,
    angle: -900,
    duration: 900,
    ease: 'Linear',
  });
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: body.y - 140, duration: 320, ease: 'Quad.easeOut' },
      { y: body.y + 260, alpha: 0, duration: 580, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

const GHOST_BODY_TINT = 0x7c7c94;
const GHOST_SOUL_TINT = 0xbfe8ff;
const GHOST_WISP_COLOR = 0xb07cff;

// Soul snatched: the body greys out and keels over backwards, lifeless,
// while a pale see-through copy of the player drifts up out of it, swaying,
// and fades away.
const ghostSoulDrain: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setTint(GHOST_BODY_TINT);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { angle: -90, duration: 380, ease: 'Bounce.easeOut' },
      { alpha: 0, delay: 350, duration: 300 },
    ],
    onComplete: () => body.destroy(),
  });

  const soul = playerStandIn(scene, x, y, textureKey, displaySize);
  soul.setTint(GHOST_SOUL_TINT);
  soul.setBlendMode(Phaser.BlendModes.ADD);
  soul.setAlpha(0.75);
  scene.tweens.add({ targets: soul, x: x + 12, duration: 180, yoyo: true, repeat: 3, ease: 'Sine.easeInOut' });
  scene.tweens.add({
    targets: soul,
    y: y - 150,
    alpha: 0,
    scaleX: soul.scaleX * 0.8,
    scaleY: soul.scaleY * 1.15,
    duration: 1000,
    ease: 'Sine.easeOut',
    onComplete: () => soul.destroy(),
  });
  burstParticles(scene, x, y - displaySize / 2, GHOST_WISP_COLOR, 14);
  scene.cameras.main.shake(80, 0.003);
};

// The original "ripped apart, then explodes" death — still used for falls
// and any hazard without its own entry below.
const shatterAndExplode: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  playPlayerShatter(scene, x, y, textureKey, displaySize);
  playDeathExplosion(scene, x, y);
  scene.cameras.main.shake(120, 0.006);
};

const DEATH_EFFECT_BY_TYPE: Partial<Record<ObjectType, DeathEffect>> = {
  saw: sawSlice,
  movingSaw: sawSlice,
  candle: candleBurn,
  bat: batKnockout,
  ghost: ghostSoulDrain,
};

export function playDeathEffect(
  scene: Phaser.Scene,
  killer: ObjectType | undefined,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): void {
  const effect = (killer && DEATH_EFFECT_BY_TYPE[killer]) ?? shatterAndExplode;
  effect(scene, x, y, textureKey, displaySize);
}
