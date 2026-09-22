import * as Phaser from 'phaser';
import type { LevelObject, ObjectType } from '../../../shared/types';
import { GRID_CELL_SIZE } from '../../../shared/constants';
import {
  BAT_AMPLITUDE_PX,
  BAT_PERIOD_MS,
  GHOST_AMPLITUDE_PX,
  GHOST_PERIOD_MS,
  MOVING_SAW_AMPLITUDE_PX,
  MOVING_SAW_PERIOD_MS,
  PLATFORM_DISPLAY_HEIGHT_PX,
  SPAWN_ICON_SIZE,
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
  spike: 'hazard',
  saw: 'hazard',
  movingSaw: 'hazard',
  candle: 'hazard',
  bat: 'hazard',
  ghost: 'hazard',
  finish: 'finish',
  spawn: 'spawn',
  doubleJump: 'powerup',
  shield: 'powerup',
  speedBoost: 'powerup',
  slowTime: 'powerup',
  autoDash: 'powerup',
};

// platform/movingPlatform are deliberately absent here — their texture
// isn't a single fixed key, it's picked per-instance by
// pickPlatformTexture (edge vs. center variant) instead of a static lookup.
const TEXTURE_BY_TYPE: Partial<Record<ObjectType, string>> = {
  ground: 'ground',
  spike: 'spike',
  saw: 'saw-spin',
  // Art is shared with the regular saw — LevelLoader is what gives the
  // moving variant its motion, not a distinct texture.
  movingSaw: 'saw-spin',
  candle: 'candle',
  bat: 'bat',
  ghost: 'ghost',
  finish: 'finish',
  doubleJump: 'doubleJump',
  shield: 'shield',
  speedBoost: 'speedBoost',
  slowTime: 'slowTime',
  autoDash: 'autoDash',
};

// Hazards whose art is an animated spritesheet rather than a static image —
// renderLevelObject plays this looping animation once per instance instead
// of leaving it parked on the sheet's first frame.
const SPIN_ANIM_BY_TYPE: Partial<Record<ObjectType, string>> = {
  saw: 'saw-spin',
  movingSaw: 'saw-spin',
};

// Exported so callers that render level objects ahead of renderLevelObject
// (or without it) can register the same animation without duplicating its
// frame/rate definition.
export function ensureHazardAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists('saw-spin')) {
    return;
  }
  scene.anims.create({
    key: 'saw-spin',
    frames: scene.anims.generateFrameNumbers('saw-spin'),
    frameRate: 16,
    repeat: -1,
  });
}

// A moving platform needs a *dynamic* Arcade body — `Body.setDirectControl`
// (used by LevelLoader to make the tween carry a standing player, instead
// of the manual `StaticBody.updateFromGameObject()` resync movingSaw uses,
// which is fine for an overlap-only hazard but wouldn't compute correct
// push/carry velocity for a collider) only exists on the dynamic Body
// class, not StaticBody. Everything else here still renders as static.
const DYNAMIC_BODY_TYPES = new Set<ObjectType>(['movingPlatform']);

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
  bat: { axis: 'x', amplitude: BAT_AMPLITUDE_PX, periodMs: BAT_PERIOD_MS },
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

const PLATFORM_TYPES = new Set<ObjectType>(['platform', 'movingPlatform']);

// 7 interchangeable center-tile textures (art directly off the sheet, not
// a generated variation) — picking between them by position instead of
// always the same one keeps a long run of platform tiles from reading as
// one texture obviously stamped over and over.
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

// Whichever side has no same-row platform tile next to it gets the
// rounded end-cap texture instead of a center tile, so a run of platform
// tiles reads as one continuous mossy block with capped ends rather than
// the same tile stamped flat across every cell. `variantSeed` (LevelLoader
// derives it from grid position) only affects which of the 7 interchangeable
// center textures gets used when both sides are open — it has no bearing on
// the edge cases.
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
  // Only meaningful for platform/movingPlatform — defaulting to "both
  // sides occupied" picks a plain center tile for any caller that doesn't
  // bother computing real adjacency (editor/curse previews render one
  // object in isolation), rather than every un-adjacent-aware call site
  // getting an end-cap that implies a run that isn't there.
  platformNeighbors: PlatformNeighbors = { left: true, right: true }
): Phaser.GameObjects.Sprite | null {
  const textureKey = PLATFORM_TYPES.has(object.type)
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

  const [originX, originY] = originFor(categoryOf(object.type));
  const sprite = scene.add
    .sprite(object.x, object.y, textureKey)
    .setOrigin(originX, originY);
  if (PLATFORM_TYPES.has(object.type)) {
    // Every variant is forced to one shared footprint (see
    // PLATFORM_DISPLAY_HEIGHT_PX) so collision stays uniform regardless of
    // which edge/center texture got picked.
    sprite.setDisplaySize(GRID_CELL_SIZE, PLATFORM_DISPLAY_HEIGHT_PX);
  }
  scene.physics.add.existing(sprite, !DYNAMIC_BODY_TYPES.has(object.type));

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
  return scene.add
    .sprite(x, y, 'spawn-marker')
    .setOrigin(0.5, 1)
    .setAlpha(0.85)
    .setDisplaySize(SPAWN_ICON_SIZE, SPAWN_ICON_SIZE);
}
