import * as Phaser from 'phaser';
import { DANCE_FRAME_MS, FINISH_DISPLAY_HEIGHT_PX } from '../constants';

// Cheap, asset-free "juice" (spec section 31: squish/pop/explosion on
// death, celebration on finish) — a one-shot particle burst using the
// shared placeholder dot texture. In a HONK-style punishing platformer,
// death (and thus this burst) fires constantly during a fast retry loop,
// so each scene gets a small pool of reused ParticleEmitter GameObjects
// instead of creating and destroying a new one per burst (the same
// create/destroy-per-effect GC churn Honk's own particle pooling fixed).
const MAX_POOLED_EMITTERS = 4;
const emitterPools = new WeakMap<
  Phaser.Scene,
  Phaser.GameObjects.Particles.ParticleEmitter[]
>();

function getEmitterPool(
  scene: Phaser.Scene
): Phaser.GameObjects.Particles.ParticleEmitter[] {
  let pool = emitterPools.get(scene);
  if (pool) {
    return pool;
  }
  pool = [];
  emitterPools.set(scene, pool);
  // GameScene reuses the same instance across death/retry (restartRun()
  // never recreates it), so the pool lives for the whole punishing retry
  // loop — it only needs tearing down when the scene actually shuts down.
  scene.events.once('shutdown', () => {
    for (const emitter of pool ?? []) {
      emitter.destroy();
    }
    emitterPools.delete(scene);
  });
  return pool;
}

export function burstParticles(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  count = 14
): void {
  const pool = getEmitterPool(scene);
  let emitter = pool.find((candidate) => candidate.getAliveParticleCount() === 0);
  if (!emitter) {
    if (pool.length < MAX_POOLED_EMITTERS) {
      emitter = scene.add.particles(0, 0, 'particle', {
        speed: { min: 80, max: 260 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0 },
        lifespan: 420,
        tint: color,
        emitting: false,
      });
      pool.push(emitter);
    } else {
      // Every pooled emitter is mid-burst (extremely unlikely for a
      // 420ms-lifespan one-shot) — reuse the oldest rather than growing
      // the pool unbounded.
      for (const pooled of pool) {
        emitter = pooled;
        break;
      }
    }
  }
  if (!emitter) {
    return;
  }
  // updateConfig merges into the existing config, so only tint changes —
  // setConfig would reset every other op (speed/angle/scale/lifespan) back
  // to its default since it re-applies the full config it's given.
  emitter.updateConfig({ tint: color });
  emitter.explode(count, x, y);
}

// A persistent glow around an object that should read as "important" at a
// glance — the finish portal and power-up pickups (placeholder art alone
// doesn't make either stand out much against the ground/hazard palette).
// Uses Phaser 4's own built-in Filters.Glow (WebGL-only, same as every
// other shader-based approach here) instead of a third-party plugin —
// `sprite.enableFilters()` + `filters.internal.addGlow()` is the engine's
// own documented pattern for exactly this. `setPaddingOverride(null)` lets
// the filter auto-expand its framebuffer so the glow isn't clipped at the
// object's original bounds. No-ops rather than throwing if filters aren't
// available (e.g. a Canvas-only fallback), since this is pure polish and
// must never be able to break level loading.
export function applyOutlineGlow(
  sprite: Phaser.GameObjects.Sprite,
  color: number,
  outerStrength = 4
): void {
  sprite.enableFilters();
  if (!sprite.filters) {
    return;
  }
  const glow = sprite.filters.internal.addGlow(color, outerStrength);
  glow.setPaddingOverride(null);
}

// Super Pixel Effects sheets, each repacked into a single-row strip at
// public/assets/vfx/<key>.webp. Preloader loads them all and, once loaded,
// builds every anim up front (createPixelFxAnims) so an effect's first
// play mid-run doesn't pay for anim setup. The pack's intended rate is
// 15fps; most run a touch faster so they finish alongside the tween work
// they accompany. Source effect per key (all _large_):
export const PIXEL_FX_SHEETS: readonly {
  key: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  loop?: boolean;
}[] = [
  // Hazard deaths (DeathEffects)
  // Movement and power-ups (Player, GameScene, LevelLoader)
  { key: 'jump-dust', frameWidth: 140, frameHeight: 50, frameRate: 20 }, // directional_impact_002 white
  { key: 'pickup-sparkle', frameWidth: 64, frameHeight: 64, frameRate: 20 }, // round_sparkle_burst_001 blue
  { key: 'pickup-flash', frameWidth: 256, frameHeight: 144, frameRate: 20 }, // round_light_burst_001 yellow
  { key: 'shield-break', frameWidth: 96, frameHeight: 96, frameRate: 15 }, // symmetrical_impact_002 blue
  { key: 'shield-zap', frameWidth: 64, frameHeight: 64, frameRate: 20 }, // lightning_burst_002 violet
  { key: 'pickup-shimmer', frameWidth: 96, frameHeight: 96, frameRate: 15, loop: true }, // status_sparkling_001 yellow
  // Level flow and curses (GameScene, CurseScene, EditorScene)
  { key: 'smoke-poof', frameWidth: 64, frameHeight: 64, frameRate: 20 }, // symmetrical_smoke_burst_001 brown
];

// Nearest filtering keeps the pixel art crisp at a non-integer scale. Anims are global, so this runs once, from Preloader.
export function createPixelFxAnims(scene: Phaser.Scene): void {
  for (const { key, frameRate, loop } of PIXEL_FX_SHEETS) {
    if (scene.anims.exists(key)) continue;
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key),
      frameRate,
      repeat: loop ? -1 : 0,
    });
  }
}

export type PixelFxOptions = {
  scale: number;
  angle?: number;
  originX?: number;
  originY?: number;
  // Start partway in, skipping the effect's lead-up.
  startFrame?: number;
  // Only needed where the scene redraws its objects right after playing
  // one (the editors rebuild every sprite on each change), which would
  // otherwise bury the effect under the redrawn objects.
  depth?: number;
};

// One-shot PIXEL_FX_SHEETS effect played at (x, y), then destroyed.
export function playPixelFx(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  { scale, angle = 0, originX = 0.5, originY = 0.5, startFrame = 0, depth }: PixelFxOptions
): void {
  const fx = scene.add.sprite(x, y, key, startFrame);
  fx.setOrigin(originX, originY);
  fx.setScale(scale);
  fx.setAngle(angle);
  if (depth !== undefined) fx.setDepth(depth);
  fx.play({ key, startFrame });
  fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
}

// Looping pixel sparkles drawn over an uncollected power-up so it catches
// the eye. LevelLoader.setPowerUpAvailable shows/hides it with the pickup.
export function attachPickupShimmer(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  const shimmer = scene.add.sprite(x, y, 'pickup-shimmer', 0);
  shimmer.play('pickup-shimmer');
  return shimmer;
}

const SHIELD_ANIM_KEY = 'shield-electric';
// The full 30-frame source loop, unlike the trimmed death VFX above — this
// one is a genuine single revolution of the ring, so cutting it short would
// visibly chop the rotation instead of just trimming a fade tail.
const SHIELD_FRAME_RATE = 30;
const SHIELD_SCALE = 0.5;
const SHIELD_BREAK_DURATION_MS = 150;

function ensureShieldAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists(SHIELD_ANIM_KEY)) {
    return;
  }
  scene.anims.create({
    key: SHIELD_ANIM_KEY,
    frames: scene.anims.generateFrameNumbers('shield-electric'),
    frameRate: SHIELD_FRAME_RATE,
    repeat: -1,
  });
}

// A persistent aura for as long as the Shield power-up is held, rather than
// only showing feedback at the moment it's consumed (the pre-existing
// flashSprite blink in Player.tryAbsorbHit) — otherwise there's no way to
// tell at a glance whether a shield is currently banked. Caller (Player)
// owns the returned sprite's lifetime: it doesn't follow anything on its
// own, so Player repositions it every update() tick to track the player
// sprite, and calls destroyElectricShield when the shield is lost.
export function attachElectricShield(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  ensureShieldAnim(scene);
  const shield = scene.add.sprite(x, y, 'shield-electric');
  shield.setScale(SHIELD_SCALE);
  shield.setBlendMode(Phaser.BlendModes.ADD);
  shield.play(SHIELD_ANIM_KEY);
  return shield;
}

// A quick pop-and-fade rather than an instant destroy() — reads as the
// shield breaking instead of just vanishing.
export function destroyElectricShield(
  scene: Phaser.Scene,
  shield: Phaser.GameObjects.Sprite
): void {
  scene.tweens.add({
    targets: shield,
    scale: shield.scale * 1.4,
    alpha: 0,
    duration: SHIELD_BREAK_DURATION_MS,
    ease: 'Quad.easeOut',
    onComplete: () => shield.destroy(),
  });
}

const HYPERSPEED_ANIM_KEY = 'hyperspeed-lines';
const HYPERSPEED_FRAME_RATE = 24;
// Small enough to read as a trail behind the player rather than a burst
// that engulfs them (the source frame is 517x515 — full size dwarfed even
// the player's own 80px sprite).
const HYPERSPEED_SCALE = 0.22;
const HYPERSPEED_FADE_IN_MS = 120;
const HYPERSPEED_FADE_OUT_MS = 220;
const HYPERSPEED_ALPHA = 0.85;

function ensureHyperspeedAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists(HYPERSPEED_ANIM_KEY)) {
    return;
  }
  scene.anims.create({
    key: HYPERSPEED_ANIM_KEY,
    frames: scene.anims.generateFrameNumbers('hyperspeed-lines'),
    frameRate: HYPERSPEED_FRAME_RATE,
    repeat: -1,
  });
}

// Speed lines trailing the player for the Speed Boost power-up's duration
// (durationMs — matches SPEED_BOOST_DURATION_MS, passed in by the caller
// rather than imported here so this stays reusable for any timed-multiplier
// pickup rather than hardcoding Speed Boost's own constant). Self-contained
// (fades itself out and destroys itself on a timer) except for position —
// same as attachElectricShield, the caller repositions the returned sprite
// every update() tick to keep it centered on the moving player.
export function playHyperspeedTrail(
  scene: Phaser.Scene,
  x: number,
  y: number,
  durationMs: number
): Phaser.GameObjects.Sprite {
  ensureHyperspeedAnim(scene);
  const trail = scene.add.sprite(x, y, 'hyperspeed-lines');
  trail.setScale(HYPERSPEED_SCALE);
  // Origin at the trailing (right) edge, not the center — (x, y) is the
  // player's back edge (see Player.syncEffectSprites/applySpeedBoost), and
  // this keeps the whole effect streaming away behind that point instead of
  // straddling it and bleeding back onto the player's body.
  trail.setOrigin(1, 0.5);
  trail.setBlendMode(Phaser.BlendModes.ADD);
  trail.setAlpha(0);
  trail.play(HYPERSPEED_ANIM_KEY);
  scene.tweens.add({
    targets: trail,
    alpha: HYPERSPEED_ALPHA,
    duration: HYPERSPEED_FADE_IN_MS,
    ease: 'Quad.easeOut',
  });
  scene.time.delayedCall(Math.max(0, durationMs - HYPERSPEED_FADE_OUT_MS), () => {
    if (!trail.active) return;
    scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: HYPERSPEED_FADE_OUT_MS,
      ease: 'Quad.easeIn',
      onComplete: () => trail.destroy(),
    });
  });
  return trail;
}

// Pins a playHyperspeedTrail sprite to the player's body: its trailing
// (right) edge at backX, squeezed vertically to exactly span topY..bottomY
// (the character's drawn head-to-toes extent) so no streaks show above or
// below them. Width keeps HYPERSPEED_SCALE — only the height is fitted, so
// the streaks stay the same length whatever pose they're squeezed to.
export function fitHyperspeedTrail(
  trail: Phaser.GameObjects.Sprite,
  backX: number,
  topY: number,
  bottomY: number
): void {
  trail.setPosition(backX, (topY + bottomY) / 2);
  trail.setScale(HYPERSPEED_SCALE, Math.max(0, bottomY - topY) / trail.height);
}

// Squash pulses on the finish gate, one per victory-dance beat
// (DANCE_FRAME_MS), each weaker than the last.
const FINISH_PULSES = 3;
const FINISH_SPARK_COLOR = 0xffc233;

// Puts the finish gate back at its resting size. Exported so GameScene can
// snap it back on a same-scene restart without duplicating this math.
export function resetFinishGate(sprite: Phaser.GameObjects.Sprite): void {
  sprite.setScale(FINISH_DISPLAY_HEIGHT_PX / sprite.frame.height);
}

export function stopFinishGateAnimation(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite
): void {
  scene.tweens.killTweensOf(sprite);
  resetFinishGate(sprite);
}

// Plays the finish gate's celebration: a violet blast fills the arch while
// the gate pulses in time with the player's dance. Purely cosmetic, same as
// burstParticles above — GameScene fires this once from onFinishReached and
// never awaits it. Only the scale moves; the sprite is bottom-anchored, so
// the gate stays planted on the ground.
export function playFinishGateAnimation(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite
): void {
  stopFinishGateAnimation(scene, sprite);
  const restScale = sprite.scaleX;

  // Middle of the arch's opening, under the banner.
  const openingY = sprite.y - sprite.displayHeight * 0.4;
  playScribbleBlast(scene, sprite.x, openingY, sprite.displayHeight * 0.8, 0x39c46a, sprite.depth + 0.01);
  burstParticles(scene, sprite.x, openingY, FINISH_SPARK_COLOR, 18);

  scene.tweens.chain({
    targets: sprite,
    tweens: Array.from({ length: FINISH_PULSES }, (_, i) => {
      const strength = 1 - i / FINISH_PULSES;
      return {
        scaleX: restScale * (1 - 0.04 * strength),
        scaleY: restScale * (1 + 0.08 * strength),
        duration: DANCE_FRAME_MS / 2,
        ease: 'Sine.easeOut',
        yoyo: true,
      };
    }),
  });
}

// A doodled blast (Kenney Scribble Platformer art, loaded by Preloader via
// DeathEffects.SCRIBBLE_FX) that pops in and fades, centered on (x, y) and
// `size` px tall. The notebook-style stand-in for the old pixel bursts.
export function playScribbleBlast(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  tint: number,
  depth = 5
): void {
  const image = scene.add.image(x, y, size > 70 ? 'scribble-blast-large' : 'scribble-blast');
  const scale = size / image.height;
  image.setTint(tint).setDepth(depth).setScale(scale * 0.3);
  scene.tweens.add({
    targets: image,
    scale,
    duration: 140,
    ease: 'Back.easeOut',
    onComplete: () =>
      scene.tweens.add({ targets: image, alpha: 0, duration: 260, delay: 120, onComplete: () => image.destroy() }),
  });
}
