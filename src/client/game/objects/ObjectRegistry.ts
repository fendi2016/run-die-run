import * as Phaser from 'phaser';
import type { LevelObject, ObjectType } from '../../../shared/types';

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
  finish: 'finish',
  spawn: 'spawn',
  doubleJump: 'powerup',
  shield: 'powerup',
  speedBoost: 'powerup',
  slowTime: 'powerup',
  autoDash: 'powerup',
};

const TEXTURE_BY_TYPE: Partial<Record<ObjectType, string>> = {
  ground: 'ground',
  platform: 'platform',
  // Placeholder art is shared with the regular platform (spec section 32:
  // art comes after gameplay) — LevelLoader is what gives it motion.
  movingPlatform: 'platform',
  spike: 'spike',
  saw: 'saw',
  // Placeholder art is shared with the regular saw (spec section 32: art
  // comes after gameplay) — LevelLoader is what gives it motion.
  movingSaw: 'saw',
  finish: 'finish',
  doubleJump: 'doubleJump',
  shield: 'shield',
  speedBoost: 'speedBoost',
  slowTime: 'slowTime',
  autoDash: 'autoDash',
};

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

// Renders a placed level object as a static Phaser image. Spawn markers
// aren't rendered (LevelLoader reads their position directly) and types
// with no registered texture yet (moving/falling/power-up variants land in
// later phases) render nothing rather than crashing.
export function renderLevelObject(
  scene: Phaser.Scene,
  object: LevelObject
): Phaser.GameObjects.Image | null {
  const textureKey = TEXTURE_BY_TYPE[object.type];
  if (!textureKey) {
    if (object.type !== 'spawn') {
      console.warn(
        `No ObjectRegistry texture for type "${object.type}" (${object.id})`
      );
    }
    return null;
  }

  const [originX, originY] = originFor(categoryOf(object.type));
  const image = scene.add
    .image(object.x, object.y, textureKey)
    .setOrigin(originX, originY);
  scene.physics.add.existing(image, !DYNAMIC_BODY_TYPES.has(object.type));
  return image;
}
