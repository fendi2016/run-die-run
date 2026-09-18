import * as Phaser from 'phaser';
import type { LevelObject, ObjectType } from '../../../shared/types';

export type ObjectCategory = 'solid' | 'hazard' | 'finish' | 'spawn' | 'unsupported';

// Object architecture must be extensible (spec section 11): adding a new
// ObjectType means adding one entry to each map below, not touching
// GameScene or LevelLoader.
const CATEGORY_BY_TYPE: Partial<Record<ObjectType, ObjectCategory>> = {
  ground: 'solid',
  platform: 'solid',
  spike: 'hazard',
  saw: 'hazard',
  finish: 'finish',
  spawn: 'spawn',
};

const TEXTURE_BY_TYPE: Partial<Record<ObjectType, string>> = {
  ground: 'ground',
  platform: 'platform',
  spike: 'spike',
  saw: 'saw',
  finish: 'finish',
};

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
      console.warn(`No ObjectRegistry texture for type "${object.type}" (${object.id})`);
    }
    return null;
  }

  const [originX, originY] = originFor(categoryOf(object.type));
  const image = scene.add.image(object.x, object.y, textureKey).setOrigin(originX, originY);
  scene.physics.add.existing(image, true);
  return image;
}
