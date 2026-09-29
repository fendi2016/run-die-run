import * as Phaser from 'phaser';
import { GROUND_LIKE_TYPES, type LevelObject, type ObjectType } from '../../../shared/types';
import { GRID_CELL_SIZE } from '../../../shared/constants';
import {
  BAT_DASH_SPEED_PX,
  BAT_DISPLAY_HEIGHT_PX,
  CANDLE_DISPLAY_HEIGHT_PX,
  CANDLE_HITBOX_WIDTH_PX,
  CEILING_SPIKES_DISPLAY_WIDTH_PX,
  CEILING_SPIKES_HITBOX_WIDTH_PX,
  CRUSHER_DISPLAY_HEIGHT_PX,
  CRUSHER_HITBOX_WIDTH_PX,
  CRUSHER_LIFT_PX,
  CRUSHER_PERIOD_MS,
  GHOST_DISPLAY_HEIGHT_PX,
  FINISH_DISPLAY_HEIGHT_PX,
  MACE_ART_SCALE,
  MACE_HITBOX_PX,
  MACE_PERIOD_MS,
  MACE_PIVOT_INSET_PX,
  MACE_SWING_DEG,
  POWERUP_DISPLAY_HEIGHT_PX,
  SAW_DISPLAY_SIZE_PX,
  SPIKE_MINE_DISPLAY_HEIGHT_PX,
  SPIKE_MINE_HITBOX_PX,
  ZAPPER_DISPLAY_HEIGHT_PX,
  ZAPPER_HITBOX_PX,
  ZAPPER_ON_FRACTION,
  ZAPPER_PERIOD_MS,
  GHOST_AMPLITUDE_PX,
  GHOST_PERIOD_MS,
  MOVING_PLATFORM_AMPLITUDE_PX,
  MOVING_PLATFORM_PERIOD_MS,
  MOVING_SAW_AMPLITUDE_PX,
  MOVING_SAW_PERIOD_MS,
  PLATFORM_DISPLAY_HEIGHT_PX,
  SAW_ROTATION_PERIOD_MS,
  SPAWN_ICON_SIZE,
  SPIKES_DISPLAY_HEIGHT_PX,
  SPIKES_HITBOX_WIDTH_PX,
} from '../constants';

export type ObjectCategory =
  'solid' | 'hazard' | 'finish' | 'spawn' | 'powerup' | 'unsupported';

// Object architecture must be extensible (spec section 11): adding a new
// ObjectType means adding one entry to each map below, not touching
// GameScene or LevelLoader.
const CATEGORY_BY_TYPE: Partial<Record<ObjectType, ObjectCategory>> = {
  ground: 'solid',
  platform: 'solid',
  movingPlatform: 'solid',
  saw: 'hazard',
  movingSaw: 'hazard',
  candle: 'hazard',
  bat: 'hazard',
  ghost: 'hazard',
  finish: 'finish',
  spawn: 'spawn',
  shield: 'powerup',
  speedBoost: 'powerup',
  // Kenney full-cell terrain blocks (Phase: Kenney level objects) — same
  // "solid" category as ground, just different art (see FULL_BLOCK_TYPES).
  brickBlock: 'solid',
  stoneBlock: 'solid',
  crateBlock: 'solid',
  grassBlock: 'solid',
  sandBlock: 'solid',
  metalBlock: 'solid',
  // Behaves exactly like 'platform'.
  bridge: 'solid',
  spikes: 'hazard',
  // The cannon body itself is solid (the player can stand on it) — only the
  // bullets it fires are lethal, and those are runtime-only, never a
  // LevelObject/category of their own.
  cannon: 'solid',
  ceilingSpikes: 'hazard',
  spikeMine: 'hazard',
  electricMine: 'hazard',
  mace: 'hazard',
  crusher: 'hazard',
  wings: 'powerup',
  stopwatch: 'powerup',
  star: 'powerup',
};

// ground/platform/movingPlatform are deliberately absent here — their
// texture isn't a single fixed key, it's picked per-instance by
// pickPlatformTexture (edge vs. center variant) instead of a static lookup.
// The new Kenney terrain blocks and bridge *do* belong here even though
// they're ground/platform-like in every other way: each is one single
// fixed texture with no separate edge/center variant art.
const TEXTURE_BY_TYPE: Partial<Record<ObjectType, string>> = {
  saw: 'saw-spin',
  // Art is shared with the regular saw — LevelLoader is what gives the
  // moving variant its motion, not a distinct texture.
  movingSaw: 'saw-spin',
  candle: 'candle',
  bat: 'bat',
  ghost: 'ghost',
  finish: 'finish-gate',
  shield: 'shield',
  speedBoost: 'speedBoost',
  brickBlock: 'block-brick',
  stoneBlock: 'block-stone',
  crateBlock: 'block-crate',
  grassBlock: 'block-grass',
  sandBlock: 'block-sand',
  metalBlock: 'block-metal',
  bridge: 'block-bridge',
  spikes: 'spikes',
  cannon: 'cannon',
  ceilingSpikes: 'ceiling-spikes',
  spikeMine: 'spike-mine',
  electricMine: 'electric-mine',
  // The chain and ball; the beam it hangs from is a second, unrotated image
  // (see renderMace).
  mace: 'mace-swing',
  crusher: 'crusher',
  wings: 'wings',
  stopwatch: 'stopwatch',
  star: 'star',
};

// The ghost/bat spritesheets (hazards/*-sheet.webp): frame size of each,
// for the Preloader. The texture keys stay the plain type names, so
// TEXTURE_BY_TYPE above didn't change. The stapler (candle) is a single
// image from the traps sheet now, with a cosmetic chomp tween instead.
export const HAZARD_SPRITESHEETS = [
  // Scribble creatures (Kenney Scribble Platformer): one frame each for now.
  { key: 'ghost', file: 'hazards/ghost-sheet.webp', frameWidth: 83, frameHeight: 123 },
  { key: 'bat', file: 'hazards/bat-sheet.webp', frameWidth: 84, frameHeight: 127 },
] as const;

// Hazards whose art is an animated spritesheet rather than a static image —
// renderLevelObject plays this looping animation once per instance instead
// of leaving it parked on the sheet's first frame. saw/movingSaw are
// deliberately absent — the sawblade reskin (Phase: Kenney level objects) is
// a single static image, spun by a continuous angle tween instead (see
// SAW_TYPES/renderLevelObject) rather than a multi-frame sheet.
const SPIN_ANIM_BY_TYPE: Partial<Record<ObjectType, string>> = {
  ghost: 'ghost-float',
  bat: 'bat-flap',
};

const HAZARD_ANIMS: readonly { key: string; texture: string; frameRate: number }[] = [
  { key: 'ghost-float', texture: 'ghost', frameRate: 8 },
  { key: 'bat-flap', texture: 'bat', frameRate: 12 },
];

// Rotated via a continuous angle tween (renderLevelObject) instead of a
// frame-based animation.
const SAW_TYPES = new Set<ObjectType>(['saw', 'movingSaw']);

// Exported so callers that render level objects ahead of renderLevelObject
// (or without it) can register the same animation without duplicating its
// frame/rate definition.
export function ensureHazardAnims(scene: Phaser.Scene): void {
  for (const anim of HAZARD_ANIMS) {
    if (scene.anims.exists(anim.key)) continue;
    scene.anims.create({
      key: anim.key,
      frames: scene.anims.generateFrameNumbers(anim.texture),
      frameRate: anim.frameRate,
      repeat: -1,
    });
  }
}

// A moving platform needs a *dynamic* Arcade body — `Body.setDirectControl`
// (used by LevelLoader to make the tween carry a standing player, instead
// of the manual `StaticBody.updateFromGameObject()` resync movingSaw uses,
// which is fine for an overlap-only hazard but wouldn't compute correct
// push/carry velocity for a collider) only exists on the dynamic Body
// class, not StaticBody.
//
// A bat needs one for a different reason: once triggered it flies on a real
// Arcade Physics velocity (see triggerBatFlight below), and only a dynamic
// Body has a settable velocity at all — a StaticBody's position never
// changes on its own. LevelLoader keeps it out of the shared `hazards`
// static group for the same reason (StaticGroup.add() would force its body
// back to static) and registers its overlap directly instead.
//
// Everything else here still renders as static.
const DYNAMIC_BODY_TYPES = new Set<ObjectType>(['movingPlatform', 'bat']);

export function categoryOf(type: ObjectType): ObjectCategory {
  return CATEGORY_BY_TYPE[type] ?? 'unsupported';
}

export type OscillationConfig = {
  axis: 'x' | 'y';
  // Signed — added directly to the object's coordinate on `axis` to get the
  // tween's yoyo target (e.g. ghost's is negative: it drifts upward).
  amplitude: number;
  periodMs: number;
};

// Every hazard that patrols back and forth via a yoyo tween (LevelLoader
// builds the actual tween; this only says which axis/amplitude/period each
// type uses) — same one-entry-per-type pattern as the maps above, so a new
// oscillating hazard never needs a new branch in LevelLoader.
const OSCILLATION_BY_TYPE: Partial<Record<ObjectType, OscillationConfig>> = {
  movingSaw: {
    axis: 'x',
    amplitude: MOVING_SAW_AMPLITUDE_PX,
    periodMs: MOVING_SAW_PERIOD_MS,
  },
  // Floats upward from its placed position rather than side to side — a
  // vertical drift reads as haunting, not a patrol.
  ghost: {
    axis: 'y',
    amplitude: -GHOST_AMPLITUDE_PX,
    periodMs: GHOST_PERIOD_MS,
  },
};

export function oscillationFor(type: ObjectType): OscillationConfig | undefined {
  return OSCILLATION_BY_TYPE[type];
}

// Tween config for a moving object's patrol/drift/rideable motion — the same
// math LevelLoader uses to build a real run's tween, factored out so the
// editor and curse-placement boards can play the identical motion live while
// placing (a bat/ghost/movingSaw/movingPlatform previously sat frozen there,
// even though every other hazard's spin animation already played). Callers
// that need LevelLoader's extra bookkeeping (registerMovingTween's
// reset/restart closure, exposing the tween for Slow Time) still build their
// own Phaser.Tweens.Tween from this config; this function only computes the
// config, never calls scene.tweens.add itself, so it has no side effects and
// no opinion on tween lifecycle. Undefined for any type with no motion.
export function motionTweenConfigFor(
  sprite: Phaser.GameObjects.Sprite,
  object: { type: ObjectType; x: number; y: number }
): Phaser.Types.Tweens.TweenBuilderConfig | undefined {
  const cycle = cyclePoseFor(sprite, object);
  if (cycle) {
    // A 0..1 phase counter rather than a tween on the sprite itself: each of
    // these poses is a function of where in the cycle it is (a swing, an
    // on/off, a lift-hold-slam), which a single yoyo can't express. Still
    // one Tween, so LevelLoader's pause/restart/Slow Time handling applies
    // unchanged.
    const state = { phase: 0 };
    return {
      targets: state,
      phase: 1,
      duration: cycle.periodMs,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => cycle.apply(state.phase),
    };
  }
  if (object.type === 'movingPlatform') {
    return {
      targets: sprite,
      x: object.x + MOVING_PLATFORM_AMPLITUDE_PX,
      duration: MOVING_PLATFORM_PERIOD_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    };
  }
  const oscillation = oscillationFor(object.type);
  if (!oscillation) {
    return undefined;
  }
  const axisTarget =
    oscillation.axis === 'x'
      ? { x: object.x + oscillation.amplitude }
      : { y: object.y + oscillation.amplitude };
  return {
    targets: sprite,
    ...axisTarget,
    duration: oscillation.periodMs,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
    // A static body's collision bounds don't follow its GameObject transform
    // on their own, so each tween step has to resync it by hand — harmless
    // to run in the editor/curse boards too, where it's a no-op cosmetic
    // resync rather than something collision detection there relies on.
    onUpdate: () => {
      if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) {
        sprite.body.reset();
      }
    },
  };
}

type CyclePose = { periodMs: number; apply: (phase: number) => void };

// Resyncs a static body after its sprite moved (or changed pose) —
// harmless in the editor boards, where nothing collides.
function syncStaticBody(sprite: Phaser.GameObjects.Sprite): void {
  if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) {
    sprite.body.reset();
  }
}

// The looping traps: each pose is recomputed from scratch for a phase in
// [0, 1), so a restart (phase back to 0) always lands the same way.
function cyclePoseFor(
  sprite: Phaser.GameObjects.Sprite,
  object: { type: ObjectType; x: number; y: number }
): CyclePose | undefined {
  if (object.type === 'electricMine') {
    return {
      periodMs: ZAPPER_PERIOD_MS,
      apply: (phase) => {
        const on = phase < ZAPPER_ON_FRACTION;
        if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) sprite.body.enable = on;
        sprite.setAlpha(on ? 1 : 0.35);
        if (on) sprite.clearTint();
        else sprite.setTint(0x9e9e9e);
      },
    };
  }
  if (object.type === 'crusher') {
    return {
      periodMs: CRUSHER_PERIOD_MS,
      apply: (phase) => {
        sprite.setY(object.y - CRUSHER_LIFT_PX * crusherLift(phase));
        syncStaticBody(sprite);
      },
    };
  }
  if (object.type === 'mace') {
    const hitbox = maceHitboxOf(sprite);
    const pivot = macePivot(object);
    return {
      periodMs: MACE_PERIOD_MS,
      apply: (phase) => {
        const angleDeg = MACE_REST_ANGLE_DEG + MACE_SWING_DEG * Math.sin(phase * Math.PI * 2);
        // Re-placed every step: a restart snaps the sprite to the authored
        // (x, y), which isn't where the pivot sits.
        sprite.setPosition(pivot.x, pivot.y).setAngle(angleDeg);
        if (!hitbox) return;
        const a = Phaser.Math.DegToRad(angleDeg);
        const bx = MACE_BALL_OFFSET.x * MACE_ART_SCALE;
        const by = MACE_BALL_OFFSET.y * MACE_ART_SCALE;
        hitbox.setPosition(
          pivot.x + bx * Math.cos(a) - by * Math.sin(a),
          pivot.y + bx * Math.sin(a) + by * Math.cos(a)
        );
        syncStaticBody(hitbox);
      },
    };
  }
  return undefined;
}

// Share of CRUSHER_LIFT_PX the crusher is raised at `phase`: resting on
// its surface, a slow lift, a pause at the top, then a fast slam.
function crusherLift(phase: number): number {
  if (phase < 0.3) return 0;
  if (phase < 0.7) return 0.5 - 0.5 * Math.cos(((phase - 0.3) / 0.4) * Math.PI);
  if (phase < 0.85) return 1;
  const t = (phase - 0.85) / 0.15;
  return 1 - t * t;
}

// The mace art (hazards/mace-*.webp) shares one 225x256 canvas: the bolt the
// chain hangs from, and the ball's center, in that canvas's pixels.
const MACE_CANVAS = { width: 225, height: 256 };
const MACE_BOLT = { x: 42, y: 24 };
const MACE_BALL_OFFSET = { x: 125 - MACE_BOLT.x, y: 185 - MACE_BOLT.y };
// The art draws the chain swung out to the right; rotating by this much
// makes it hang straight down.
const MACE_REST_ANGLE_DEG = Phaser.Math.RadToDeg(Math.atan2(MACE_BALL_OFFSET.x, MACE_BALL_OFFSET.y));
const MACE_HITBOX_DATA_KEY = 'maceHitbox';

function macePivot(object: { x: number; y: number }): { x: number; y: number } {
  return { x: object.x, y: object.y - GRID_CELL_SIZE + MACE_PIVOT_INSET_PX };
}

// The mace's lethal part is only the ball, so it gets its own small
// invisible hitbox sprite that follows the swing; the chain sprite's own
// body stays disabled. LevelLoader registers this in its place.
export function maceHitboxOf(sprite: Phaser.GameObjects.Sprite): Phaser.GameObjects.Sprite | undefined {
  const hitbox: unknown = sprite.getData(MACE_HITBOX_DATA_KEY);
  return hitbox instanceof Phaser.GameObjects.Sprite ? hitbox : undefined;
}

function renderMace(scene: Phaser.Scene, object: LevelObject): Phaser.GameObjects.Sprite {
  const pivot = macePivot(object);
  const origin = { x: MACE_BOLT.x / MACE_CANVAS.width, y: MACE_BOLT.y / MACE_CANVAS.height };
  const sprite = scene.add
    .sprite(pivot.x, pivot.y, 'mace-swing')
    .setOrigin(origin.x, origin.y)
    .setScale(MACE_ART_SCALE)
    .setAngle(MACE_REST_ANGLE_DEG);
  const beam = scene.add
    .image(pivot.x, pivot.y, 'mace-beam')
    .setOrigin(origin.x, origin.y)
    .setScale(MACE_ART_SCALE)
    .setDepth(sprite.depth + 0.01);
  const hitbox = scene.add
    .sprite(pivot.x, pivot.y, '__DEFAULT')
    .setDisplaySize(MACE_HITBOX_PX, MACE_HITBOX_PX)
    .setVisible(false);
  scene.physics.add.existing(hitbox, true);
  sprite.setData(MACE_HITBOX_DATA_KEY, hitbox);
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
    beam.destroy();
    hitbox.destroy();
  });
  scene.physics.add.existing(sprite, true);
  if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) sprite.body.enable = false;
  cyclePoseFor(sprite, object)?.apply(0);
  return sprite;
}

// Locks the bat onto (targetX, targetY) — the player's exact position at
// the instant this is called — and sends it flying in that fixed direction
// at a constant velocity forever, never re-aiming afterward. This only owns
// the physics math once the decision to fire has already been made; the
// decision itself (the moment the bat's x enters the camera's current view)
// needs live per-frame camera/player state this module has no access to, so
// it's GameScene's update() that decides *when* to call this.
export function triggerBatFlight(
  sprite: Phaser.GameObjects.Sprite,
  targetX: number,
  targetY: number
): void {
  if (!(sprite.body instanceof Phaser.Physics.Arcade.Body)) {
    return;
  }
  const dx = targetX - sprite.x;
  const dy = targetY - sprite.y;
  const length = Math.hypot(dx, dy) || 1;
  sprite.body.setVelocity(
    (dx / length) * BAT_DASH_SPEED_PX,
    (dy / length) * BAT_DASH_SPEED_PX
  );
}

// ground and platform/movingPlatform are both "solid terrain, placed in
// horizontal runs" and share the same mossy-stone tileset art — ground
// keeps its old 60x60 footprint (TILESET_DISPLAY_SIZE), platform/
// movingPlatform use the thinner PLATFORM_DISPLAY_HEIGHT_PX.
const TILESET_TYPES = new Set<ObjectType>(['ground', 'platform', 'movingPlatform']);

// Every type forced to the same GRID_CELL_SIZE square footprint as 'ground'
// (GROUND_LIKE_TYPES, shared/types.ts — the Kenney full-cell terrain
// blocks), plus the cannon body, which isn't offered as terrain but needs
// the identical one-cell solid footprint. Unlike TILESET_TYPES, each of
// these is one fixed texture (TEXTURE_BY_TYPE), not a per-instance
// edge/center pick.
function isFullBlockType(type: ObjectType): boolean {
  return GROUND_LIKE_TYPES.has(type) || type === 'cannon';
}

// 7 interchangeable center-tile textures (art directly off the sheet, not
// a generated variation) — picking between them by position instead of
// always the same one keeps a long run of tiles from reading as one
// texture obviously stamped over and over.
const PLATFORM_CENTER_KEYS = [
  'platform-top-center-1',
  'platform-top-center-2',
  'platform-top-center-3',
  'platform-top-center-4',
  'platform-top-center-5',
  'platform-top-center-6',
  'platform-top-center-7',
];

export type PlatformNeighbors = { left: boolean; right: boolean };

// Whichever side has no same-row same-type tile next to it gets the
// rounded end-cap texture instead of a center tile, so a run of ground or
// platform tiles reads as one continuous mossy block with capped ends
// rather than the same tile stamped flat across every cell. `variantSeed`
// (LevelLoader derives it from grid position) only affects which of the 7
// interchangeable center textures gets used when both sides are open — it
// has no bearing on the edge cases.
export function pickPlatformTexture(
  neighbors: PlatformNeighbors,
  variantSeed: number
): string {
  if (!neighbors.left) {
    return 'platform-top-left-edge';
  }
  if (!neighbors.right) {
    return 'platform-top-right-edge';
  }
  const index =
    ((variantSeed % PLATFORM_CENTER_KEYS.length) + PLATFORM_CENTER_KEYS.length) %
    PLATFORM_CENTER_KEYS.length;
  return PLATFORM_CENTER_KEYS[index] as string;
}

const POWERUP_TYPES = new Set<ObjectType>(['shield', 'speedBoost', 'wings', 'stopwatch', 'star']);

// Static body shrunk to `width` x `height` (default: the display height),
// centered on the drawing, so edge scribbles don't count as contact.
function shrinkStaticBody(sprite: Phaser.GameObjects.Sprite, width: number, height = sprite.displayHeight): void {
  if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) sprite.body.setSize(width, height);
}

// A solid's `y` is authored as its walkable top face (spawn position and
// fall-death both assume that), so it must be top-anchored — the tile's
// body extends downward, below the surface, out of view. A hazard or the
// finish sits ON that surface, so it's bottom-anchored at the same `y`
// instead. Using one origin for every type here previously placed solids
// with their top face a full tile above `y`, spawning the player already
// embedded inside the ground body (Arcade Physics doesn't recover from an
// already-overlapping dynamic/static spawn — the player fell straight
// through instead of landing).
function originFor(category: ObjectCategory): [number, number] {
  return category === 'solid' ? [0.5, 0] : [0.5, 1];
}

// Renders a placed level object as a static Phaser sprite (a Sprite, not
// just an Image, so hazards with an animated texture — see
// SPIN_ANIM_BY_TYPE — can play it). Spawn markers aren't rendered
// (LevelLoader reads their position directly) and types with no registered
// texture yet (falling/power-up variants land in later phases) render
// nothing rather than crashing.
export function renderLevelObject(
  scene: Phaser.Scene,
  object: LevelObject,
  // Only meaningful for ground/platform/movingPlatform — defaulting to
  // "both sides occupied" picks a plain center tile for any caller that
  // doesn't bother computing real adjacency (editor/curse previews render
  // one object in isolation), rather than every un-adjacent-aware call
  // site getting an end-cap that implies a run that isn't there.
  platformNeighbors: PlatformNeighbors = { left: true, right: true }
): Phaser.GameObjects.Sprite | null {
  const textureKey = TILESET_TYPES.has(object.type)
    ? pickPlatformTexture(platformNeighbors, Math.round(object.x / GRID_CELL_SIZE))
    : TEXTURE_BY_TYPE[object.type];
  if (!textureKey) {
    if (object.type !== 'spawn') {
      console.warn(
        `No ObjectRegistry texture for type "${object.type}" (${object.id})`
      );
    }
    return null;
  }

  if (object.type === 'mace') return renderMace(scene, object);

  const [originX, originY] = originFor(categoryOf(object.type));
  const sprite = scene.add
    .sprite(object.x, object.y, textureKey)
    .setOrigin(originX, originY);
  if (object.type === 'ground' || isFullBlockType(object.type)) {
    // Matches the old ground.webp's native 60x60 footprint exactly, so
    // ground collision is unchanged — only its art is now edge-aware. Every
    // Kenney terrain block (and the cannon body) shares this exact
    // footprint too, regardless of the source art's own aspect ratio.
    sprite.setDisplaySize(GRID_CELL_SIZE, GRID_CELL_SIZE);
  } else if (TILESET_TYPES.has(object.type) || object.type === 'bridge') {
    // Every platform/movingPlatform/bridge variant is forced to one shared
    // footprint (see PLATFORM_DISPLAY_HEIGHT_PX) so collision stays
    // uniform regardless of which edge/center texture got picked.
    sprite.setDisplaySize(GRID_CELL_SIZE, PLATFORM_DISPLAY_HEIGHT_PX);
  } else if (object.type === 'bat') {
    sprite.setScale(BAT_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'candle') {
    sprite.setScale(CANDLE_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'ghost') {
    sprite.setScale(GHOST_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'finish') {
    // Aspect preserved (unlike bat's forced squash).
    sprite.setScale(FINISH_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'spikes') {
    // Aspect preserved — the source art is already low-and-wide.
    sprite.setScale(SPIKES_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (SAW_TYPES.has(object.type)) {
    // Spun about its own center (a sprite rotates about its origin): with
    // the bottom-center origin every other hazard uses, the blade swept a
    // circle half into the ground while its hitbox stayed put. Same box,
    // since the center sits half a blade above the authored surface y.
    sprite
      .setDisplaySize(SAW_DISPLAY_SIZE_PX, SAW_DISPLAY_SIZE_PX)
      .setOrigin(0.5, 0.5)
      .setY(object.y - SAW_DISPLAY_SIZE_PX / 2);
  } else if (object.type === 'ceilingSpikes') {
    sprite.setScale(CEILING_SPIKES_DISPLAY_WIDTH_PX / sprite.width);
  } else if (object.type === 'spikeMine') {
    sprite.setScale(SPIKE_MINE_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'electricMine') {
    sprite.setScale(ZAPPER_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (object.type === 'crusher') {
    sprite.setScale(CRUSHER_DISPLAY_HEIGHT_PX / sprite.height);
  } else if (POWERUP_TYPES.has(object.type)) {
    sprite.setScale(POWERUP_DISPLAY_HEIGHT_PX / sprite.height);
  }
  scene.physics.add.existing(sprite, !DYNAMIC_BODY_TYPES.has(object.type));
  if (object.type === 'candle' && sprite.body instanceof Phaser.Physics.Arcade.StaticBody) {
    sprite.body.setSize(CANDLE_HITBOX_WIDTH_PX, sprite.displayHeight);
  }
  if (object.type === 'spikes' && sprite.body instanceof Phaser.Physics.Arcade.StaticBody) {
    // Slightly narrower than the art so a jump that clips the very edge of
    // a spike tip still reads as a clean clear.
    sprite.body.setSize(SPIKES_HITBOX_WIDTH_PX, sprite.displayHeight);
  }
  if (object.type === 'ceilingSpikes') shrinkStaticBody(sprite, CEILING_SPIKES_HITBOX_WIDTH_PX);
  if (object.type === 'spikeMine') shrinkStaticBody(sprite, SPIKE_MINE_HITBOX_PX, SPIKE_MINE_HITBOX_PX);
  if (object.type === 'electricMine') shrinkStaticBody(sprite, ZAPPER_HITBOX_PX, ZAPPER_HITBOX_PX);
  if (object.type === 'crusher') shrinkStaticBody(sprite, CRUSHER_HITBOX_WIDTH_PX);

  // A dynamic body inherits the game's world gravity the instant it's
  // created, so a movingPlatform rendered anywhere that isn't a live run
  // (EditorScene's board, CurseScene's read-only base level and its pending
  // preview) silently free-falls off the bottom of the screen the moment
  // it's placed. Only LevelLoader used to turn gravity off, and only for
  // the copy it loads into GameScene. No caller ever wants this body to
  // fall — its motion always comes from a tween — so it's disabled here,
  // at the single point where the dynamic body is created.
  if (sprite.body instanceof Phaser.Physics.Arcade.Body) {
    sprite.body.setAllowGravity(false);
  }

  const spinAnim = SPIN_ANIM_BY_TYPE[object.type];
  if (spinAnim) {
    ensureHazardAnims(scene);
    // randomFrame: every saw in a level would otherwise start on frame 0
    // and spin in lockstep — visibly synchronized blades read as robotic
    // rather than as independent hazards.
    sprite.play({ key: spinAnim, randomFrame: true });
  }
  if (SAW_TYPES.has(object.type)) {
    // A single sawblade image, spun by angle instead of a multi-frame
    // sheet (Phase: Kenney level objects reskin) — purely cosmetic, no
    // effect on the body's size/shape. A random starting angle is this
    // rotation's equivalent of randomFrame above: every saw in a level
    // would otherwise spin in lockstep.
    sprite.setAngle(Math.random() * 360);
    scene.tweens.add({
      targets: sprite,
      angle: `+=360`,
      duration: SAW_ROTATION_PERIOD_MS,
      repeat: -1,
      ease: 'Linear',
    });
  }
  if (object.type === 'candle') {
    // Purely cosmetic chomp (the art used to be an 8-frame sheet); the
    // static body keeps the size it was created with.
    const baseScaleY = sprite.scaleY;
    scene.tweens.add({
      targets: sprite,
      scaleY: baseScaleY * 0.88,
      duration: 140,
      yoyo: true,
      repeat: -1,
      repeatDelay: 380,
      delay: Math.random() * 500,
      ease: 'Quad.easeOut',
    });
  }

  return sprite;
}

// Editor/curse-preview-only marker for a spawn point — renderLevelObject
// deliberately renders nothing for 'spawn' at runtime (LevelLoader reads
// its position directly), but the editors still need *some* visual so
// placing one doesn't look like the tap did nothing. Sized to fit inside
// one grid tile (SPAWN_ICON_SIZE), unlike the real in-run player sprite.
export function renderSpawnMarker(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  const marker = scene.add.sprite(x, y, 'spawn-marker').setOrigin(0.5, 1).setAlpha(0.85);
  marker.setScale(SPAWN_ICON_SIZE / marker.height);
  return marker;
}
