import * as Phaser from 'phaser';
import { DANCE_FRAME_MS, FINISH_DISPLAY_HEIGHT_PX } from '../constants';
import { finishOriginX } from '../objects/ObjectRegistry';

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

const DEATH_EXPLOSION_ANIM_KEY = 'death-explosion';
// The spritesheet loaded in Preloader is already trimmed to the source
// pack's first 24 frames (of 30) — this stops short of even those, at the
// frame where the fireball's still a visible sparking ring rather than
// riding it out to fully invisible, so the anim doesn't end on a dead
// frame.
const DEATH_EXPLOSION_FRAME_COUNT = 20;
// Fast enough that all 20 frames clear in well under half a second — the
// source pack's native ~1s pace reads as a slow cutscene, not a death in a
// fast-retry punishing platformer (spec section 6's retry-loop target).
const DEATH_EXPLOSION_FRAME_RATE = 50;
const DEATH_EXPLOSION_SCALE = 0.62;
const KABOOM_SCALE = 0.62;
const KABOOM_POP_DURATION_MS = 90;
const KABOOM_HOLD_MS = 220;
const KABOOM_FADE_DURATION_MS = 160;

function ensureDeathExplosionAnim(scene: Phaser.Scene): void {
  if (scene.anims.exists(DEATH_EXPLOSION_ANIM_KEY)) {
    return;
  }
  scene.anims.create({
    key: DEATH_EXPLOSION_ANIM_KEY,
    frames: scene.anims.generateFrameNumbers('death-explosion', {
      start: 0,
      end: DEATH_EXPLOSION_FRAME_COUNT - 1,
    }),
    frameRate: DEATH_EXPLOSION_FRAME_RATE,
    repeat: 0,
  });
}

// "Quick and absurd" death VFX (spec section 31's squish/pop/explosion,
// escalated) — a fireball spritesheet burst layered with a comic-book
// "KABOOM" pop-in, both one-shot and self-destroying like burstParticles
// above. Two separate GameObjects (not one composited texture) since they
// animate on entirely different mechanisms: the fireball is a genuine
// frame-by-frame spritesheet anim, while the KABOOM source art is static
// per-frame (see Preloader's comment) and gets its motion from a tween
// instead.
export function playDeathExplosion(scene: Phaser.Scene, x: number, y: number): void {
  ensureDeathExplosionAnim(scene);

  const fireball = scene.add.sprite(x, y, 'death-explosion', 0);
  fireball.setScale(DEATH_EXPLOSION_SCALE);
  // Additive blending so the bright core reads as a flash of light against
  // the level's dark background scrim (GameScene's -0.5-depth rectangle)
  // instead of a flat orange sticker.
  fireball.setBlendMode(Phaser.BlendModes.ADD);
  fireball.play(DEATH_EXPLOSION_ANIM_KEY);
  fireball.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    fireball.destroy();
  });

  // A slight random tilt per death — a perfectly axis-aligned comic burst
  // reads as a UI element; a few degrees off reads as text slapped onto
  // the scene in a hurry, which is the joke.
  const kaboom = scene.add.image(x, y, 'death-kaboom');
  kaboom.setAngle(Phaser.Math.Between(-8, 8));
  kaboom.setAlpha(0);
  kaboom.setScale(KABOOM_SCALE * 0.6);
  scene.tweens.add({
    targets: kaboom,
    alpha: 1,
    scale: KABOOM_SCALE,
    duration: KABOOM_POP_DURATION_MS,
    ease: 'Back.easeOut',
  });
  scene.tweens.add({
    targets: kaboom,
    alpha: 0,
    scale: KABOOM_SCALE * 1.1,
    delay: KABOOM_POP_DURATION_MS + KABOOM_HOLD_MS,
    duration: KABOOM_FADE_DURATION_MS,
    ease: 'Quad.easeIn',
    onComplete: () => kaboom.destroy(),
  });
}

const SLIDE_IMPACT_ANIM_KEY = 'slide-impact';
// ~73px on screen: about the robot's height, so the streaks frame the
// feet rather than swallowing the whole character.
const SLIDE_IMPACT_SCALE = 0.5;

// One-shot white streak burst where a slide kicks off (Player.startSlide).
// Left in the world at that spot rather than following the player, so the
// robot visibly slides away out of it. The source pack runs at 30fps.
export function playSlideImpact(scene: Phaser.Scene, x: number, y: number): void {
  if (!scene.anims.exists(SLIDE_IMPACT_ANIM_KEY)) {
    scene.anims.create({
      key: SLIDE_IMPACT_ANIM_KEY,
      frames: scene.anims.generateFrameNumbers('slide-impact'),
      frameRate: 30,
      repeat: 0,
    });
  }
  const burst = scene.add.sprite(x, y, 'slide-impact', 0);
  burst.setScale(SLIDE_IMPACT_SCALE);
  burst.play(SLIDE_IMPACT_ANIM_KEY);
  burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
}

export type PixelFxOptions = {
  scale: number;
  // The pack's intended rate is 15fps; some effects run a touch faster so
  // they finish alongside the tween work they accompany.
  frameRate?: number;
  angle?: number;
  originX?: number;
  originY?: number;
  // Only needed where the scene redraws its objects right after playing
  // one (the editors rebuild every sprite on each change), which would
  // otherwise bury the effect under the redrawn objects.
  depth?: number;
};

// One-shot Super Pixel Effects sheet (a single-row strip whose texture and
// anim share `key`) played at (x, y), then destroyed. Nearest filtering
// keeps the pixel art crisp at a non-integer scale, same as playSlideDust.
export function playPixelFx(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  { scale, frameRate = 15, angle = 0, originX = 0.5, originY = 0.5, depth }: PixelFxOptions
): void {
  if (!scene.anims.exists(key)) {
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key),
      frameRate,
      repeat: 0,
    });
  }
  const fx = scene.add.sprite(x, y, key, 0);
  fx.setOrigin(originX, originY);
  fx.setScale(scale);
  fx.setAngle(angle);
  if (depth !== undefined) fx.setDepth(depth);
  fx.play(key);
  fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
}

const PICKUP_SHIMMER_KEY = 'pickup-shimmer';

// Looping pixel sparkles drawn over an uncollected power-up so it catches
// the eye. LevelLoader.setPowerUpAvailable shows/hides it with the pickup.
export function attachPickupShimmer(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  if (!scene.anims.exists(PICKUP_SHIMMER_KEY)) {
    scene.textures.get(PICKUP_SHIMMER_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.anims.create({
      key: PICKUP_SHIMMER_KEY,
      frames: scene.anims.generateFrameNumbers(PICKUP_SHIMMER_KEY),
      frameRate: 15,
      repeat: -1,
    });
  }
  const shimmer = scene.add.sprite(x, y, PICKUP_SHIMMER_KEY, 0);
  shimmer.play(PICKUP_SHIMMER_KEY);
  return shimmer;
}

// Pixel-art blood burst centered on (x, y). A touch faster than the pack's
// 15fps so it finishes alongside the saw slice (~0.5s).
export function playBloodSplatter(scene: Phaser.Scene, x: number, y: number, scale: number): void {
  playPixelFx(scene, 'blood-splatter', x, y, { scale, frameRate: 20 });
}

const SLIDE_DUST_ANIM_KEY = 'slide-dust';
// vfx 2 pack, 426.png row 5 (white): 64px pixel-art frames whose ground line
// sits at y=46, so that's the origin — the puff sits on the floor.
const SLIDE_DUST_GROUND_Y = 46 / 64;

// Pixel-art dust kicked up under the feet while sliding (Player.updateSlide
// calls this on start and every SLIDE_DUST_INTERVAL_MS after). Mirrored so
// the debris sprays back, away from the direction of travel. Nearest
// filtering keeps the pixel art crisp at a non-integer scale.
export function playSlideDust(scene: Phaser.Scene, x: number, y: number, scale: number): void {
  if (!scene.anims.exists(SLIDE_DUST_ANIM_KEY)) {
    scene.textures.get('slide-dust').setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.anims.create({
      key: SLIDE_DUST_ANIM_KEY,
      frames: scene.anims.generateFrameNumbers('slide-dust'),
      frameRate: 24,
      repeat: 0,
    });
  }
  const puff = scene.add.sprite(x, y, 'slide-dust', 0);
  puff.setOrigin(0.5, SLIDE_DUST_GROUND_Y);
  puff.setScale(scale);
  puff.setFlipX(true);
  puff.play(SLIDE_DUST_ANIM_KEY);
  puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
}

const SHATTER_GRID = 3;
const SHATTER_DURATION_MS = 380;

// Slices the player's current pose into a cols x rows grid of image pieces
// laid over exactly where the (bottom-center-origin, see Player.ts) sprite
// was drawn, each centered on its own cell so it can move and spin
// independently. Pure runtime cropping of the already-loaded texture — no
// new art. Shared by every death effect that breaks the player apart
// (playPlayerShatter here, the candle's crumble in DeathEffects); callers
// own the pieces' motion and must destroy them.
export function slicePlayerFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number,
  cols: number,
  rows: number
): { piece: Phaser.GameObjects.Image; col: number; row: number }[] {
  const frame = scene.textures.getFrame(textureKey);
  const scale = displaySize / frame.width;
  const cellSourceW = frame.width / cols;
  const cellSourceH = frame.height / rows;
  const topLeftX = x - displaySize / 2;
  const topLeftY = y - displaySize;
  const texture = scene.textures.get(textureKey);
  const pieces: { piece: Phaser.GameObjects.Image; col: number; row: number }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // A real sub-frame per cell rather than setCrop: a cropped image still
      // renders at its crop offset and rotates about the full image's
      // origin, whereas a frame gives each piece its own center to position
      // and spin around. Registered once per texture and grid, reused after.
      const frameName = `__slice_${cols}x${rows}_${col}_${row}`;
      if (!texture.has(frameName)) {
        texture.add(
          frameName,
          frame.sourceIndex,
          frame.cutX + col * cellSourceW,
          frame.cutY + row * cellSourceH,
          cellSourceW,
          cellSourceH
        );
      }
      const piece = scene.add.image(
        topLeftX + (col + 0.5) * cellSourceW * scale,
        topLeftY + (row + 0.5) * cellSourceH * scale,
        textureKey,
        frameName
      );
      piece.setScale(scale);
      pieces.push({ piece, col, row });
    }
  }
  return pieces;
}

// "Ripped apart" death VFX (user ask, replacing the old single frozen
// player-death pose): slices whatever frame the player was on at the
// moment of death into a grid of pieces that fly outward and spin away.
// The default death (falls, and any hazard without its own entry in
// DeathEffects) fires this immediately before playDeathExplosion so the
// fireball reads as consuming the pieces rather than the other way round.
export function playPlayerShatter(
  scene: Phaser.Scene,
  x: number,
  y: number,
  textureKey: string,
  displaySize: number
): void {
  const center = (SHATTER_GRID - 1) / 2;
  for (const { piece, col, row } of slicePlayerFrame(
    scene, x, y, textureKey, displaySize, SHATTER_GRID, SHATTER_GRID
  )) {
    // Flies outward from the grid center — corner pieces go diagonally,
    // the middle piece has no natural direction so it gets a random one.
    const dirX = col - center || Phaser.Math.FloatBetween(-1, 1);
    const dirY = row - center || Phaser.Math.FloatBetween(-1, 1);
    const magnitude = Phaser.Math.Between(40, 90);

    scene.tweens.add({
      targets: piece,
      x: piece.x + dirX * magnitude,
      y: piece.y + dirY * magnitude + 30,
      angle: Phaser.Math.Between(-240, 240),
      alpha: 0,
      duration: SHATTER_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => piece.destroy(),
    });
  }
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

// Swing poses in order, one per victory-dance beat (DANCE_FRAME_MS) so the
// bell rings in time with the player's dance: the two tilted frames
// alternate like a pendulum (rings fading as the swing dies down), settle on
// the resting frame, then the success frame fades in over two beats.
const FINISH_SWINGS: readonly string[] = [
  'finish-hit',
  'finish-ringing',
  'finish-hit',
  'finish-ringing',
  'finish-hit',
  'finish-ringing',
  'finish-idle',
];
const FINISH_SUCCESS_FADE_MS = DANCE_FRAME_MS * 2;
const FINISH_RING_COLOR = 0x39ff88;

// Sets one of the finish bell's reference-art frames. Origin comes from
// finishOriginX (see ObjectRegistry.FINISH_ORIGIN_X) so the gallows post
// stays planted while the bell/motion-lines/ghosts around it change extent.
// Scale is the SAME for every frame (fit from the resting frame's height):
// the frames share one pixel scale, and fitting each to the display height
// separately shrank the taller success frame (its ghosts add headroom) by
// ~30%, making the whole bell jump. Exported so GameScene can snap the bell
// back to rest on a same-scene restart without duplicating this math.
export function setFinishFrame(sprite: Phaser.GameObjects.Sprite, textureKey: string): number {
  sprite.setTexture(textureKey);
  sprite.setOrigin(finishOriginX(textureKey), 1);
  const restHeight = sprite.scene.textures.getFrame('finish-idle')?.height ?? sprite.height;
  const scale = FINISH_DISPLAY_HEIGHT_PX / restHeight;
  sprite.setScale(scale);
  return scale;
}

// Pending timers/overlay per bell, so a restart mid-animation can cancel it
// (stopFinishBellAnimation) instead of a late timer flipping frames on a
// bell that's supposed to be back at rest.
const bellRuns = new WeakMap<
  Phaser.GameObjects.Sprite,
  { timers: Phaser.Time.TimerEvent[]; overlay: Phaser.GameObjects.Sprite | undefined }
>();

export function stopFinishBellAnimation(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite
): void {
  const run = bellRuns.get(sprite);
  if (!run) return;
  for (const timer of run.timers) timer.remove(false);
  if (run.overlay) {
    scene.tweens.killTweensOf(run.overlay);
    run.overlay.destroy();
  }
  bellRuns.delete(sprite);
}

// An expanding, fading ring from the bell — the "sound" of each strike.
// `strength` (0..1) shrinks and fades later rings as the swing dies down.
function ringPulse(scene: Phaser.Scene, x: number, y: number, depth: number, strength: number): void {
  const ring = scene.add
    .circle(x, y, 22)
    .setStrokeStyle(4, FINISH_RING_COLOR, 0.9 * strength)
    .setDepth(depth - 0.1);
  scene.tweens.add({
    targets: ring,
    scale: 1 + 3.5 * strength,
    alpha: 0,
    duration: 520,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}

// Plays the bell's swing -> success sequence. Purely cosmetic, same as
// burstParticles above — GameScene fires this once from onFinishReached and
// never awaits it; the post itself never moves or scales.
export function playFinishBellAnimation(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite
): void {
  stopFinishBellAnimation(scene, sprite);
  scene.tweens.killTweensOf(sprite);
  sprite.setRotation(0).setAlpha(1);
  setFinishFrame(sprite, 'finish-idle');

  // The bell hangs right of the post, a bit below the crossbar.
  const bellX = sprite.x + sprite.displayWidth * (0.62 - sprite.originX);
  const bellY = sprite.y - sprite.displayHeight * 0.45;
  const depth = sprite.depth;
  const run: { timers: Phaser.Time.TimerEvent[]; overlay: Phaser.GameObjects.Sprite | undefined } = {
    timers: [],
    overlay: undefined,
  };
  bellRuns.set(sprite, run);

  let at = 0;
  FINISH_SWINGS.forEach((frame, index) => {
    const strength = 1 - index / FINISH_SWINGS.length;
    run.timers.push(
      scene.time.delayedCall(at, () => {
        if (!sprite.active) return;
        setFinishFrame(sprite, frame);
        if (frame !== 'finish-idle') ringPulse(scene, bellX, bellY, depth, strength);
      })
    );
    at += DANCE_FRAME_MS;
  });

  run.timers.push(
    scene.time.delayedCall(at, () => {
      if (!sprite.active) return;
      // Cross-fade rather than swap, so the ghosts and glowing eyes rise
      // out of the resting bell instead of popping in.
      const overlay = scene.add.sprite(sprite.x, sprite.y, 'finish-success').setDepth(depth + 0.01);
      setFinishFrame(overlay, 'finish-success');
      overlay.setAlpha(0);
      run.overlay = overlay;
      burstParticles(scene, bellX, bellY, FINISH_RING_COLOR, 18);
      ringPulse(scene, bellX, bellY, depth, 1);
      scene.tweens.add({
        targets: overlay,
        alpha: 1,
        duration: FINISH_SUCCESS_FADE_MS,
        ease: 'Sine.easeOut',
        onComplete: () => {
          if (sprite.active) setFinishFrame(sprite, 'finish-success');
          overlay.destroy();
          run.overlay = undefined;
          bellRuns.delete(sprite);
        },
      });
    })
  );
}
