import * as Phaser from 'phaser';
import { FINISH_DISPLAY_HEIGHT_PX, PLAYER_DISPLAY_WIDTH_SCALE, PLAYER_SIZE } from '../constants';
import { playSfx } from './Sfx';

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
// Roughly twice (fireball) and one and a half (KABOOM) times the pencil:
// big enough to be a KABOOM, not so big it swallows the screen (falls and
// mines both use it).
const DEATH_EXPLOSION_SCALE = 0.42;
const KABOOM_SCALE = 0.6;
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
  // Normal blending: the old additive blend glowed against the dark
  // Halloween backdrop but washes out to nothing on the white paper.
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

// One-shot effect sheets, each a single-row strip at
// public/assets/vfx/<key>.webp. Two styles on purpose: pixel-art deaths,
// lightning and fireworks (VFX Free Pack / Super Pixel Effects), and doodle
// dust/sparkles from Boogie's "Doodle RPG" pack (Particles/*.png; free for
// commercial use, edits allowed) packed on the frame sizes the pixel
// versions used, so every caller's scale still fits.
// Preloader loads them all and, once loaded, builds every anim up front
// (createPixelFxAnims) so an effect's first play mid-run doesn't pay for
// anim setup. Source per key:
export const PIXEL_FX_SHEETS: readonly {
  key: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  loop?: boolean;
  // Pixel-art sheets (VFX Free Pack / Super Pixel Effects) get nearest
  // filtering so they stay crisp at a non-integer scale; doodles smooth.
  pixel?: boolean;
}[] = [
  // Hazard deaths (DeathEffects) — pixel art
  { key: 'blood-splatter', frameWidth: 64, frameHeight: 64, frameRate: 20, pixel: true }, // burst_splatter_001 red
  { key: 'blood-spray', frameWidth: 48, frameHeight: 48, frameRate: 20, pixel: true }, // directional_splatter_003 red, mirrored to spray up-left
  { key: 'ghost-skull-smoke', frameWidth: 64, frameHeight: 64, frameRate: 15, pixel: true }, // stylized_skull_smoke_burst_001 white
  // Movement and power-ups (Player, GameScene, LevelLoader)
  { key: 'jump-dust', frameWidth: 140, frameHeight: 50, frameRate: 14 }, // Particle1, mirrored to both sides
  { key: 'pickup-sparkle', frameWidth: 64, frameHeight: 64, frameRate: 20 }, // Glimmer, inked yellow
  { key: 'pickup-flash', frameWidth: 256, frameHeight: 144, frameRate: 18 }, // Wham
  { key: 'shield-break', frameWidth: 96, frameHeight: 96, frameRate: 14 }, // Particle2
  { key: 'shield-zap', frameWidth: 64, frameHeight: 64, frameRate: 18 }, // Wham
  { key: 'pickup-shimmer', frameWidth: 96, frameHeight: 96, frameRate: 12, loop: true }, // three Glimmers, staggered
  // Level flow and curses (GameScene, CurseScene, EditorScene)
  { key: 'firework-green', frameWidth: 96, frameHeight: 96, frameRate: 15, pixel: true }, // round_firework_burst_001 green
  { key: 'firework-yellow', frameWidth: 96, frameHeight: 96, frameRate: 15, pixel: true }, // round_firework_burst_002 yellow
  { key: 'curse-strike', frameWidth: 128, frameHeight: 128, frameRate: 20, pixel: true }, // lightning_strike_001 violet
  { key: 'smoke-poof', frameWidth: 64, frameHeight: 64, frameRate: 20 }, // Puff
  { key: 'dizzy-stars', frameWidth: 166, frameHeight: 125, frameRate: 12, loop: true }, // Stunned (mace deaths)
];

// Anims are global, so this runs once, from Preloader.
export function createPixelFxAnims(scene: Phaser.Scene): void {
  for (const { key, frameRate, loop, pixel } of PIXEL_FX_SHEETS) {
    if (scene.anims.exists(key)) continue;
    if (pixel) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
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

// Looping doodle twinkles drawn over an uncollected power-up so it catches
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

// Pixel-art blood burst centered on (x, y).
export function playBloodSplatter(scene: Phaser.Scene, x: number, y: number, scale: number): void {
  playPixelFx(scene, 'blood-splatter', x, y, { scale });
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
  // As wide as the live pencil is drawn (Player's display sprite).
  const scaleX = scale * PLAYER_DISPLAY_WIDTH_SCALE;
  const cellSourceW = frame.width / cols;
  const cellSourceH = frame.height / rows;
  const topLeftX = x - (displaySize * PLAYER_DISPLAY_WIDTH_SCALE) / 2;
  const topLeftY = y - displaySize;
  const texture = scene.textures.get(textureKey);
  // Texture.add() makes the first frame ever added the texture's default,
  // so a later plain setTexture(key) (Player's fall pose) would show one
  // corner slice — an invisible player whose shrunken frame also threw its
  // physics body off the ground — on every attempt after this death.
  const defaultFrame = texture.firstFrame;
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
        topLeftX + (col + 0.5) * cellSourceW * scaleX,
        topLeftY + (row + 0.5) * cellSourceH * scale,
        textureKey,
        frameName
      );
      piece.setScale(scaleX, scale);
      pieces.push({ piece, col, row });
    }
  }
  texture.firstFrame = defaultFrame;
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
  // Normal blend: additive (made for the old dark backdrop) all but
  // vanishes on the white paper.
  shield.play(SHIELD_ANIM_KEY);
  return shield;
}

// Looping sparkles around the player for as long as the Star lasts. Like
// attachElectricShield, the caller owns it: Player repositions it every
// frame and destroys it when the Star runs out.
export function attachStarSparkle(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  const sparkle = scene.add.sprite(x, y, 'pickup-shimmer', 0).setName('star-aura');
  sparkle.setScale(1.15).setTint(0xffd84a);
  sparkle.play('pickup-shimmer');
  return sparkle;
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

// Speed Boost: short ink dashes peel off the pencil's back and fade, like
// motion lines drawn in the margin. Player emits one every few frames at a
// random height between his head and feet (so none float above him); each
// is a world object that stays put while he runs away from it, then fades.
const SPEED_LINE_INK = 0x2b2b2b;
const SPEED_LINE_MS = 220;

export function emitSpeedLine(scene: Phaser.Scene, backX: number, y: number): void {
  const length = Phaser.Math.Between(16, 34);
  const line = scene.add.graphics({ x: backX, y }).setName('speed-line');
  line.lineStyle(2.5, SPEED_LINE_INK, 0.7);
  line.lineBetween(0, 0, -length, 0);
  scene.tweens.add({
    targets: line,
    x: backX - 26,
    alpha: 0,
    duration: SPEED_LINE_MS,
    ease: 'Quad.easeOut',
    onComplete: () => line.destroy(),
  });
}

// Where the mouth sits in markers/finish.webp: left of center by this
// fraction of the display width, up from the base by this fraction of the
// display height.
const FINISH_MOUTH_OFFSET_X = 0.38;
const FINISH_MOUTH_HEIGHT = 0.73;

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

// Clear-screen finish: the pencil launches himself tip-first, in one low
// arc, straight into the hole on the sharpener's upper-left face and
// slides in, vanishing at the hole while it rumbles and spits shavings.
// Then the gag: the sharpener gulps, squirts three fountains of cartoon
// blood out of its lid slot, and spits his eraser out, which falls off the
// bottom of the screen. All on stand-ins (the caller has already hidden the
// real physics player; the finish sensor itself only has its scale
// tweened). destroy() stops everything, for a restart mid-animation.
const DIVE_TEXTURE = 'player-dive';
// player/player-dive.webp (300x226, from the user's diving.png): where the
// tip and the eraser sit, in frame pixels.
const DIVE_FRAME = { width: 300, height: 226 };
const DIVE_TIP = { x: 298, y: 169.5 };
const DIVE_ERASER = { x: 42, y: 104, cropWidth: 84 };
// The drawn pencil leans down to the right at this slope; he flies and
// slides along it.
const DIVE_SLOPE = (DIVE_TIP.y - 93) / DIVE_TIP.x;
const DIVE_LENGTH = PLAYER_SIZE * 1.15;
const DIVE_ARC_MS = 300;
const DIVE_ARC_LIFT = 40;
const DIVE_SLIDE_MS = 620;
const DIVE_GRIND_MS = 300;
const SPURT_GAP_MS = 230;
const ERASER_SCALE = 1.6;
// The slot on the sharpener's lid, right of centre by this fraction of its
// display width, up from the base by this fraction of its height.
const SLOT_OFFSET_X = 0.13;
const SLOT_HEIGHT = 0.95;
const SHAVING_WOOD = 0xf2c078;
const SHAVING_GRAPHITE = 0x3a3a3a;
const BLOOD_RED = 0xe0303a;

export type SharpenerDive = { destroy: () => void };

export function playSharpenerDive(
  scene: Phaser.Scene,
  from: { x: number; y: number },
  sharpener: Phaser.GameObjects.Sprite,
  onInside: () => void
): SharpenerDive {
  const mouthX = sharpener.x - sharpener.displayWidth * FINISH_MOUTH_OFFSET_X;
  const mouthY = sharpener.y - sharpener.displayHeight * FINISH_MOUTH_HEIGHT;
  const slotX = sharpener.x + sharpener.displayWidth * SLOT_OFFSET_X;
  const slotY = sharpener.y - sharpener.displayHeight * SLOT_HEIGHT;
  const depth = sharpener.depth + 0.02;
  const norm = Math.hypot(1, DIVE_SLOPE);
  const dir = { x: 1 / norm, y: DIVE_SLOPE / norm };
  const restScale = FINISH_DISPLAY_HEIGHT_PX / sharpener.frame.height;
  const diveScale = DIVE_LENGTH / DIVE_FRAME.width;
  const timers: Phaser.Time.TimerEvent[] = [];
  const later = (delay: number, fn: () => void) => timers.push(scene.time.delayedCall(delay, fn));
  const spawned: Phaser.GameObjects.GameObject[] = [];

  // `tip` is where the pencil's point is; placeTip() draws him there and
  // hides whatever has gone past the hole.
  // He usually trips the finish sensor already level with the hole, so
  // start the tip short of it (never cropped on its first frame).
  const tip = { x: Math.min(from.x + DIVE_LENGTH * 0.35, mouthX - 12), y: from.y - PLAYER_SIZE * 0.5 };
  const pencil = scene.add
    .image(tip.x, tip.y, DIVE_TEXTURE)
    .setName('sharpener-dive')
    .setOrigin(DIVE_TIP.x / DIVE_FRAME.width, DIVE_TIP.y / DIVE_FRAME.height)
    .setScale(diveScale)
    .setDepth(depth);
  const placeTip = () => {
    pencil.setPosition(tip.x, tip.y);
    const left = tip.x - pencil.displayWidth * pencil.originX;
    const visible = Phaser.Math.Clamp((mouthX - left) / pencil.scaleX, 0, DIVE_FRAME.width);
    pencil.setCrop(0, 0, visible, DIVE_FRAME.height);
  };
  placeTip();
  window.__SKETCHY_DIVE_INSIDE__ = false;

  const shavings = () => {
    burstParticles(scene, mouthX, mouthY, SHAVING_WOOD, 6);
    burstParticles(scene, mouthX, mouthY, SHAVING_GRAPHITE, 3);
  };

  // A squirt of blood up out of the lid slot, falling back under gravity.
  const spurt = (strength: number) => {
    const fountain = scene.add.particles(slotX, slotY, 'particle', {
      angle: { min: -118, max: -62 },
      speed: { min: 220 + strength * 60, max: 330 + strength * 90 },
      gravityY: 950,
      scale: { start: 1.7, end: 0.6 },
      lifespan: 700,
      tint: BLOOD_RED,
      emitting: false,
    });
    fountain.setDepth(depth);
    fountain.explode(18 + strength * 8);
    spawned.push(fountain);
    later(700, () => fountain.destroy());
  };

  const spitEraser = () => {
    playSfx(scene, 'sharpenTwang');
    const eraser = scene.add
      .image(slotX, slotY, DIVE_TEXTURE)
      .setName('sharpener-eraser')
      .setDepth(depth)
      .setCrop(0, 0, DIVE_ERASER.cropWidth, DIVE_FRAME.height)
      .setOrigin(DIVE_ERASER.x / DIVE_FRAME.width, DIVE_ERASER.y / DIVE_FRAME.height)
      .setScale(diveScale * ERASER_SCALE);
    spawned.push(eraser);
    // Up out of the slot, then straight down past the bottom of the view.
    const offscreenY = scene.cameras.main.worldView.bottom + eraser.displayHeight * 2;
    const driftX = sharpener.x + sharpener.displayWidth * 0.6;
    scene.tweens.add({ targets: eraser, x: driftX, angle: 540, duration: 1100, ease: 'Linear' });
    scene.tweens.chain({
      targets: eraser,
      tweens: [
        { y: slotY - 150, duration: 320, ease: 'Quad.easeOut' },
        {
          y: offscreenY,
          duration: 780,
          ease: 'Quad.easeIn',
          onComplete: () => eraser.setVisible(false),
        },
      ],
    });
  };

  // The gag, once he's all the way in.
  const gulpAndSpurt = () => {
    window.__SKETCHY_DIVE_INSIDE__ = true;
    scene.tweens.killTweensOf(sharpener);
    sharpener.setScale(restScale);
    scene.tweens.add({
      targets: sharpener,
      scaleX: restScale * 1.1,
      scaleY: restScale * 0.88,
      duration: 110,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    for (let i = 0; i < 3; i++) {
      later(140 + i * SPURT_GAP_MS, () => {
        playSfx(scene, 'sharpenSquelch');
        spurt(i);
        scene.tweens.add({
          targets: sharpener,
          scaleY: restScale * (1.05 + i * 0.03),
          duration: 70,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
      });
    }
    later(140 + 3 * SPURT_GAP_MS, () => {
      spitEraser();
      onInside();
    });
  };

  // Rumbles (scale only) and spits shavings while he goes in.
  const grind = () => {
    playSfx(scene, 'sharpenGrind');
    scene.tweens.add({
      targets: sharpener,
      scaleX: restScale * 1.03,
      scaleY: restScale * 0.98,
      duration: 60,
      yoyo: true,
      repeat: Math.floor(DIVE_SLIDE_MS / 120),
    });
    timers.push(scene.time.addEvent({ delay: 110, repeat: 4, callback: shavings }));
  };

  // One low arc from where he stopped to just short of the hole, lined up
  // on its slope, then the slide in. (onUpdate on each tween: a chain's
  // own onUpdate never fires.)
  const lineUp = { x: mouthX - dir.x * DIVE_LENGTH * 0.3, y: mouthY - dir.y * DIVE_LENGTH * 0.3 };
  const apexY = Math.min(tip.y, lineUp.y) - DIVE_ARC_LIFT;
  scene.tweens.add({ targets: tip, x: lineUp.x, duration: DIVE_ARC_MS, ease: 'Sine.easeInOut', onUpdate: placeTip });
  scene.tweens.chain({
    targets: tip,
    tweens: [
      { y: apexY, duration: DIVE_ARC_MS / 2, ease: 'Quad.easeOut', onUpdate: placeTip },
      { y: lineUp.y, duration: DIVE_ARC_MS / 2, ease: 'Quad.easeIn', onUpdate: placeTip },
      {
        x: mouthX + dir.x * DIVE_LENGTH,
        y: mouthY + dir.y * DIVE_LENGTH,
        duration: DIVE_SLIDE_MS,
        ease: 'Sine.easeIn',
        onStart: grind,
        onUpdate: placeTip,
      },
    ],
    onComplete: () => {
      placeTip();
      pencil.setVisible(false);
      scene.cameras.main.shake(DIVE_GRIND_MS, 0.003);
      shavings();
      later(DIVE_GRIND_MS, gulpAndSpurt);
    },
  });

  return {
    destroy: () => {
      for (const timer of timers) timer.remove();
      scene.tweens.killTweensOf([pencil, tip, ...spawned]);
      pencil.destroy();
      for (const object of spawned) object.destroy();
      stopFinishGateAnimation(scene, sharpener);
    },
  };
}

// A level's first spawn: the pencil pops up out of the pencil case (drawn
// cut off at the case's front rim, so he climbs out from inside), then
// hops over to the spawn point and lands. A stand-in again; `onLanded`
// is when the caller shows the real player. finish() skips straight to
// the landing (the player tapped to start early, or the run restarted).
const EMERGE_RISE_MS = 300;
const EMERGE_HOP_MS = 340;
// The top of the case's front rim, down from its top edge as a fraction
// of its display height (markers/spawn.webp).
const CASE_RIM = 0.47;

export type CaseEmerge = { finish: () => void };

export function playCaseEmerge(
  scene: Phaser.Scene,
  pencilCase: Phaser.GameObjects.Image,
  spawn: { x: number; y: number },
  onLanded: () => void
): CaseEmerge {
  const caseX = pencilCase.x - pencilCase.displayWidth * pencilCase.originX + pencilCase.displayWidth / 2;
  const caseTop = pencilCase.y - pencilCase.displayHeight * pencilCase.originY;
  const rimY = caseTop + pencilCase.displayHeight * CASE_RIM;
  const caseScale = pencilCase.scaleX;
  const pencil = scene.add
    .image(caseX, pencilCase.y, 'player-jump-rise')
    .setName('spawn-emerge')
    .setOrigin(0.5, 1)
    .setDepth(pencilCase.depth + 0.01)
    .setDisplaySize(PLAYER_SIZE * PLAYER_DISPLAY_WIDTH_SCALE, PLAYER_SIZE);
  let done = false;

  // Only the part above the rim shows while he's still inside.
  const clipAtRim = () => {
    const top = pencil.y - pencil.displayHeight;
    const visible = Phaser.Math.Clamp((rimY - top) / pencil.scaleY, 0, pencil.frame.height);
    pencil.setCrop(0, 0, pencil.frame.width, visible);
  };
  clipAtRim();

  const finish = () => {
    if (done) return;
    done = true;
    scene.tweens.killTweensOf([pencil, pencilCase]);
    pencilCase.setScale(caseScale);
    pencil.destroy();
    playPixelFx(scene, 'jump-dust', spawn.x, spawn.y, { scale: 0.6, originY: 1 });
    onLanded();
  };

  scene.tweens.add({
    targets: pencil,
    y: rimY + PLAYER_SIZE * 0.35,
    duration: EMERGE_RISE_MS,
    ease: 'Back.easeOut',
    onStart: () => {
      playSfx(scene, 'spawnPop');
      scene.tweens.add({
        targets: pencilCase,
        scaleX: caseScale * 1.08,
        scaleY: caseScale * 0.9,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    },
    onUpdate: clipAtRim,
    onComplete: () => {
      if (done) return;
      pencil.setCrop();
      pencil.setTexture('player-jump-tuck').setDisplaySize(PLAYER_SIZE * PLAYER_DISPLAY_WIDTH_SCALE, PLAYER_SIZE);
      playSfx(scene, 'jump');
      scene.tweens.add({ targets: pencil, x: spawn.x, duration: EMERGE_HOP_MS, ease: 'Linear' });
      scene.tweens.chain({
        targets: pencil,
        tweens: [
          { y: Math.min(pencil.y, spawn.y) - 60, duration: EMERGE_HOP_MS * 0.45, ease: 'Quad.easeOut' },
          { y: spawn.y, duration: EMERGE_HOP_MS * 0.55, ease: 'Quad.easeIn' },
        ],
        onComplete: finish,
      });
    },
  });

  return { finish };
}

// The player being scribbled into existence: a pen scrawl hatches up
// over a `width` x `height` box standing on (x, groundY), then fades.
// `onDrawn` fires the moment the scrawl reaches the top, which is when
// GameScene reveals the player, so the pencil appears out of the ink.
const SCRIBBLE_INK = 0x2b2b2b;
const SCRIBBLE_LINE_PX = 3;
// Vertical gap between hatch strokes; smaller is denser.
const SCRIBBLE_STEP_PX = 7;
const SCRIBBLE_FADE_MS = 220;

export function playScribbleIn(
  scene: Phaser.Scene,
  x: number,
  groundY: number,
  width: number,
  height: number,
  drawMs: number,
  onDrawn?: () => void
): void {
  // Back-and-forth strokes from the feet up, each end wobbling a little
  // past the box so it reads as a quick hand scrawl, not a raster fill.
  const points: Phaser.Math.Vector2[] = [];
  const strokes = Math.ceil(height / SCRIBBLE_STEP_PX);
  for (let i = 0; i <= strokes; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // Narrower at the bottom and top, like the pencil's silhouette.
    const t = i / strokes;
    const halfW = (width / 2) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.3)));
    points.push(
      new Phaser.Math.Vector2(
        x + side * halfW + Phaser.Math.FloatBetween(-4, 4),
        groundY - i * SCRIBBLE_STEP_PX + Phaser.Math.FloatBetween(-3, 3)
      )
    );
  }
  const lengths = points.slice(1).map((p, i) => p.distance(points[i] ?? p));
  const total = lengths.reduce((sum, l) => sum + l, 0);

  const ink = scene.add.graphics().setDepth(5);
  const drawTo = (progress: number): void => {
    const first = points[0];
    if (!first) return;
    ink.clear();
    ink.lineStyle(SCRIBBLE_LINE_PX, SCRIBBLE_INK, 1);
    ink.beginPath();
    ink.moveTo(first.x, first.y);
    let left = progress * total;
    for (let i = 1; i < points.length && left > 0; i++) {
      const from = points[i - 1];
      const to = points[i];
      const len = lengths[i - 1] ?? 0;
      if (!from || !to || len === 0) continue;
      const f = Math.min(1, left / len);
      ink.lineTo(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f);
      left -= len;
    }
    ink.strokePath();
  };

  const state = { progress: 0 };
  scene.tweens.add({
    targets: state,
    progress: 1,
    duration: drawMs,
    ease: 'Sine.easeIn',
    onUpdate: () => drawTo(state.progress),
    onComplete: () => {
      onDrawn?.();
      scene.tweens.add({
        targets: ink,
        alpha: 0,
        duration: SCRIBBLE_FADE_MS,
        onComplete: () => ink.destroy(),
      });
    },
  });
}
