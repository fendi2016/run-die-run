import * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';
import {
  burstParticles,
  playBloodSplatter,
  playDeathExplosion,
  playPixelFx,
  playPlayerShatter,
  slicePlayerFrame,
} from './Juice';

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

const CHAR_TINT = 0x1c1414;
const EMBER_COLOR = 0xff8a2a;
const ASH_GRID = 4;
const CANDLE_CHAR_MS = 220;
// ash-smoke's first puff sits at the bottom of its 64px frame; anchoring
// there sets it on the floor, rising off the ash pile.
const ASH_SMOKE_BASE_Y = 60 / 64;

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
    playPixelFx(scene, 'ash-smoke', x, y, { scale: 2, originY: ASH_SMOKE_BASE_Y });
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
const ZAP_VIOLET = 0xb07cff;

// Impaled from below: the body jolts up onto the points, sags, and a
// spray of red goes up past it.
const spikesImpale: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x, y - displaySize * 0.2, { scale: 2, angle: -90 });
  playBloodSplatter(scene, x, y - displaySize * 0.1, 1.5);
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: y - 18, scaleY: body.scaleY * 1.1, duration: 90, ease: 'Quad.easeOut' },
      { y: y + 10, scaleY: body.scaleY * 0.85, duration: 260, ease: 'Bounce.easeOut' },
      { alpha: 0, delay: 380, duration: 260 },
    ],
    onComplete: () => body.destroy(),
  });
};

// Pinned from above: squashed flat against the points, then drops.
const ceilingSpikesPin: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x, y - displaySize, { scale: 2, angle: 90 });
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 0.7, scaleX: body.scaleX * 1.15, duration: 80, ease: 'Quad.easeOut' },
      { y: y + 260, alpha: 0, delay: 220, duration: 520, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

// Blown to bits: orange pixel explosion with the pose ripped into pieces.
const mineBlast: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  playPlayerShatter(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'mine-explosion', x, y - displaySize / 2, { scale: 3 });
  burstParticles(scene, x, y - displaySize / 2, INK, 18);
  scene.cameras.main.shake(160, 0.01);
};

// Electrocuted: the body strobes between white and a dark "x-ray" fill
// while jittering, violet lightning cracks around it, then it collapses.
const zapperFry: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setTintMode(Phaser.TintModes.FILL);
  let lit = false;
  const strobe = scene.time.addEvent({
    delay: 50,
    repeat: 9,
    callback: () => {
      lit = !lit;
      body.setTint(lit ? 0xffffff : INK);
      body.setX(x + (lit ? 3 : -3));
    },
  });
  playPixelFx(scene, 'zap-burst', x, y - displaySize / 2, { scale: 2.5 });
  scene.time.delayedCall(180, () =>
    playPixelFx(scene, 'zap-burst', x, y - displaySize * 0.7, { scale: 1.8, angle: 90 })
  );
  burstParticles(scene, x, y - displaySize / 2, ZAP_VIOLET, 16);
  scene.cameras.main.shake(260, 0.004);
  scene.time.delayedCall(520, () => {
    strobe.remove();
    body.clearTint().setX(x);
    playPixelFx(scene, 'ash-smoke', x, y, { scale: 1.5, originY: ASH_SMOKE_BASE_Y });
    scene.tweens.add({
      targets: body,
      scaleY: 0.01,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => body.destroy(),
    });
  });
};

// Whacked by the mace: star impact, then launched spinning up and away.
const maceWhack: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setOrigin(0.5, 0.5).setY(y - displaySize / 2);
  playPixelFx(scene, 'whack-impact', x, y - displaySize / 2, { scale: 2 });
  burstParticles(scene, x, y - displaySize / 2, SPARK_YELLOW, 14);
  scene.cameras.main.shake(140, 0.009);
  scene.tweens.add({ targets: body, x: x - 320, angle: -720, duration: 1000, ease: 'Linear' });
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: body.y - 220, duration: 380, ease: 'Quad.easeOut' },
      { y: body.y + 320, alpha: 0, duration: 620, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

// Flattened: a pancake on the ground with dust puffing out both sides.
const crusherFlatten: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'crush-dust', x - displaySize * 0.4, y, { scale: 1.6, originY: 1 });
  playPixelFx(scene, 'crush-dust', x + displaySize * 0.4, y, { scale: 1.6, originY: 1 });
  scene.cameras.main.shake(120, 0.012);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 0.12, scaleX: body.scaleX * 1.7, duration: 70, ease: 'Quad.easeIn' },
      { alpha: 0, delay: 600, duration: 300 },
    ],
    onComplete: () => body.destroy(),
  });
};

const DEATH_EFFECT_BY_TYPE: Partial<Record<ObjectType, DeathEffect>> = {
  saw: sawSlice,
  movingSaw: sawSlice,
  candle: candleBurn,
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
