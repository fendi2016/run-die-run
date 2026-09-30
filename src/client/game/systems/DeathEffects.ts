import * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';
import {
  attachElectricShield,
  burstParticles,
  playBloodSplatter,
  playDeathExplosion,
  playPixelFx,
  playPlayerShatter,
  slicePlayerFrame,
} from './Juice';
import { playSfx } from './Sfx';

// The pencil ✗ DeathMarkers draws where other players died (loaded by
// Preloader).
export const SCRIBBLE_FX = [{ key: 'scribble-x', file: 'vfx/scribble-x.webp' }] as const;

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

// Every full-body stand-in is tagged so a restart can clear it: several
// deaths outlast the respawn delay, and a quick retry would otherwise show
// the old body still falling next to the new pencil.
const STAND_IN_NAME = 'death-stand-in';

export function clearDeathStandIns(scene: Phaser.Scene): void {
  for (const object of scene.children.list.filter((o) => o.name === STAND_IN_NAME)) {
    scene.tweens.killTweensOf(object);
    object.destroy();
  }
}

// A copy of the player's current pose laid exactly over the real sprite.
function playerStandIn(
  scene: Phaser.Scene,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): Phaser.GameObjects.Image {
  const image = scene.add.image(x, y, textureKey).setName(STAND_IN_NAME);
  image.setOrigin(0.5, 1);
  image.setDisplaySize(displaySize, displaySize);
  return image;
}

const SAW_SPARK_COLOR = 0xffd23f;
const SAW_GORE_COLOR = 0xe0303a;
// 64px source frames -> ~128px burst, a bit wider than the 80px player.
const SAW_SPLATTER_SCALE = 2;
// blood-spray starts in its frame's bottom-right corner and sprays up-left,
// the same way the top half is flung.
const SAW_SPRAY_ORIGIN = 0.82;

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
  playPixelFx(scene, 'blood-spray', x, cutY, {
    scale: SAW_SPLATTER_SCALE,
    originX: SAW_SPRAY_ORIGIN,
    originY: SAW_SPRAY_ORIGIN,
  });
  scene.cameras.main.shake(140, 0.008);
};

const STAPLE_STEEL = 0xc9d1d9;
const STAPLE_INK = 0x2b2b2b;
const BLOOD = 0xe0303a;

// A staple seen from the front: the crown across the pencil, legs driven in.
function drawStaple(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Graphics {
  const staple = scene.add.graphics({ x, y }).setName(STAND_IN_NAME).setDepth(1);
  const half = 10;
  const legs = 5;
  for (const [width, color] of [
    [5, STAPLE_INK],
    [2.5, STAPLE_STEEL],
  ] as const) {
    staple.lineStyle(width, color, 1);
    staple.beginPath();
    staple.moveTo(-half, legs);
    staple.lineTo(-half, 0);
    staple.lineTo(half, 0);
    staple.lineTo(half, legs);
    staple.strokePath();
  }
  return staple;
}

// Stapled: two staples punch through the pencil one after the other, each
// with a jolt, a "chk" and a few drops of red, then he droops and keels
// over backwards, pinned. Done well inside the respawn delay.
const staplerStaple: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  const restX = body.scaleX;
  const restY = body.scaleY;
  const staples: Phaser.GameObjects.Graphics[] = [];
  // The first "chk" is the death sound itself (Sfx.DEATH_SFX_BY_TYPE).
  const punch = (heightFraction: number, withSound: boolean) => {
    const stapleY = y - displaySize * heightFraction;
    const staple = drawStaple(scene, x, stapleY).setScale(1.5);
    staples.push(staple);
    scene.tweens.add({ targets: staple, scale: 1, duration: 70, ease: 'Quad.easeIn' });
    scene.tweens.add({
      targets: body,
      scaleX: restX * 1.08,
      scaleY: restY * 0.92,
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    burstParticles(scene, x, stapleY, BLOOD, 6);
    if (withSound) playSfx(scene, 'deathStaple');
    scene.cameras.main.shake(60, 0.004);
  };
  punch(0.62, false);
  scene.time.delayedCall(110, () => {
    if (body.active) punch(0.4, true);
  });
  scene.time.delayedCall(250, () => {
    if (!body.active) return;
    scene.tweens.add({
      targets: [body, ...staples],
      alpha: 0,
      delay: 90,
      duration: 180,
      onComplete: () => {
        body.destroy();
        for (const staple of staples) staple.destroy();
      },
    });
    scene.tweens.add({ targets: body, angle: -24, duration: 200, ease: 'Quad.easeIn' });
  });
};

const BAT_HIT_COLOR = 0xffffff;
// bat-impact is a burst off a floor: spikes point up from a ring along its
// frame's bottom edge. Anchored on that ring and turned 90° clockwise, it
// bursts off the player's front, back toward where the bat came from.
const BAT_IMPACT_BASE_Y = 0.9;

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
  playPixelFx(scene, 'bat-impact', x + displaySize / 3, y - displaySize / 2, {
    scale: 1.5,
    angle: 90,
    originY: BAT_IMPACT_BASE_Y,
  });
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
  // A skull puffs out of the body as the soul leaves it.
  playPixelFx(scene, 'ghost-skull-smoke', x, y - displaySize * 0.75, { scale: 2 });
  scene.cameras.main.shake(80, 0.003);
};

// The original "ripped apart, then explodes" death — still used for falls
// and any hazard without its own entry below.
const shatterAndExplode: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  playPlayerShatter(scene, x, y, textureKey, displaySize);
  playDeathExplosion(scene, x, y);
  scene.cameras.main.shake(120, 0.006);
};

const INK = 0x2b2b2b;
const SPARK_YELLOW = 0xffd23f;
const ZAP_CYAN = 0x7fe7ff;

// Every trap death below reads in its first ~120ms (a fast retry skips
// the rest after RESPAWN_SKIP_AFTER_MS) and is gone by ~520ms, inside the
// RESPAWN_DELAY_MS auto-restart, with effects about the pencil's size.

// Impaled from below: a jolt up onto the points, a squirt of red, then he
// sags onto them and fades.
const spikesImpale: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x + 6, y - 4, { scale: 0.9, originX: 0.82, originY: 0.82 });
  burstParticles(scene, x, y - displaySize * 0.15, BLOOD, 10);
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: y - 12, scaleY: body.scaleY * 1.06, duration: 70, ease: 'Quad.easeOut' },
      { y: y + 6, scaleY: body.scaleY * 0.9, angle: 10, duration: 200, ease: 'Bounce.easeOut' },
      { alpha: 0, duration: 200 },
    ],
    onComplete: () => body.destroy(),
  });
};

// Pinned from above: stretched up onto the points, red drips down, then he
// drops free and fades.
const ceilingSpikesPin: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x - 6, y - displaySize, { scale: 0.9, angle: 180, originX: 0.82, originY: 0.82 });
  burstParticles(scene, x, y - displaySize, BLOOD, 10);
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 1.12, scaleX: body.scaleX * 0.92, duration: 80, ease: 'Quad.easeOut' },
      { y: y + 60, alpha: 0, delay: 140, duration: 280, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

// Blown up: the painted fireball and a KABOOM, the pose flying apart, and
// dark shrapnel.
const mineBlast: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  playPlayerShatter(scene, x, y, textureKey, displaySize);
  playDeathExplosion(scene, x, y);
  burstParticles(scene, x, y - displaySize / 2, INK, 14);
  scene.cameras.main.shake(160, 0.01);
};

// Electrocuted: the blue zap ring crackles round him while he strobes
// between himself and a black silhouette (the cartoon x-ray), then he
// crumbles in a puff.
const zapperFry: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setTintMode(Phaser.TintModes.FILL);
  const ring = attachElectricShield(scene, x, y - displaySize / 2).setName(STAND_IN_NAME).setScale(0.4);
  burstParticles(scene, x, y - displaySize / 2, ZAP_CYAN, 14);
  scene.cameras.main.shake(260, 0.004);
  let lit = false;
  const strobe = scene.time.addEvent({
    delay: 45,
    repeat: 6,
    callback: () => {
      if (!body.active) return;
      lit = !lit;
      if (lit) body.setTint(INK);
      else body.clearTint();
      body.setX(x + (lit ? 2 : -2));
    },
  });
  scene.time.delayedCall(320, () => {
    strobe.remove();
    ring.destroy();
    if (!body.active) return;
    body.setTint(INK).setX(x);
    playPixelFx(scene, 'smoke-poof', x, y - displaySize * 0.35, { scale: 1.3 });
    scene.tweens.add({
      targets: body,
      scaleY: 0.01,
      alpha: 0,
      duration: 200,
      ease: 'Quad.easeIn',
      onComplete: () => body.destroy(),
    });
  });
};

// Whacked by the mace: a comic WHAM, then he's knocked back head over heels
// with stars circling his head.
const maceWhack: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setOrigin(0.5, 0.5).setY(y - displaySize / 2);
  const stars = scene.add
    .sprite(x, y - displaySize - 4, 'dizzy-stars', 0)
    .setName(STAND_IN_NAME)
    .setScale(0.55)
    .play('dizzy-stars');
  playPixelFx(scene, 'shield-zap', x + displaySize * 0.3, y - displaySize / 2, { scale: 1.4 });
  burstParticles(scene, x, y - displaySize / 2, SPARK_YELLOW, 10);
  scene.cameras.main.shake(140, 0.009);
  scene.tweens.add({ targets: body, angle: -540, duration: 500, ease: 'Linear' });
  scene.tweens.add({ targets: [body, stars], x: '-=170', duration: 500, ease: 'Quad.easeOut' });
  scene.tweens.chain({
    targets: [body, stars],
    tweens: [
      { y: '-=90', duration: 220, ease: 'Quad.easeOut' },
      { y: '+=150', alpha: 0, duration: 280, ease: 'Quad.easeIn' },
    ],
    onComplete: () => {
      body.destroy();
      stars.destroy();
    },
  });
};

// Flattened into a pencil pancake, with dust puffing out both sides.
const crusherFlatten: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'smoke-poof', x - displaySize * 0.55, y - 12, { scale: 1.1 });
  playPixelFx(scene, 'smoke-poof', x + displaySize * 0.55, y - 12, { scale: 1.1 });
  scene.cameras.main.shake(120, 0.012);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 0.26, scaleX: body.scaleX * 1.5, duration: 60, ease: 'Quad.easeIn' },
      { scaleY: body.scaleY * 0.32, duration: 90, yoyo: true, ease: 'Quad.easeOut' },
      { alpha: 0, delay: 120, duration: 200 },
    ],
    onComplete: () => body.destroy(),
  });
};

const DEATH_EFFECT_BY_TYPE: Partial<Record<ObjectType, DeathEffect>> = {
  saw: sawSlice,
  movingSaw: sawSlice,
  candle: staplerStaple,
  bat: batKnockout,
  ghost: ghostSoulDrain,
  spikes: spikesImpale,
  ceilingSpikes: ceilingSpikesPin,
  spikeMine: mineBlast,
  electricMine: zapperFry,
  mace: maceWhack,
  crusher: crusherFlatten,
};

export function playDeathEffect(
  scene: Phaser.Scene,
  killer: ObjectType | undefined,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): void {
  const own = killer === undefined ? undefined : DEATH_EFFECT_BY_TYPE[killer];
  // Read by the playtest scenarios to tell a trap's own death from the fallback.
  Reflect.set(window, '__SKETCHY_LAST_DEATH__', own ? killer : 'generic');
  const effect = own ?? shatterAndExplode;
  effect(scene, x, y, textureKey, displaySize);
}
