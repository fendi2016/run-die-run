import * as Phaser from 'phaser';
import type { LevelObject, ObjectType } from '../../../shared/types';
import { SPAWN_ICON_SIZE } from '../constants';

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
  // Art is shared with the regular platform — LevelLoader is what gives
  // the moving variant its motion, not a distinct texture.
  movingPlatform: 'platform',
  spike: 'spike',
  saw: 'saw-spin',
  // Art is shared with the regular saw — LevelLoader is what gives the
  // moving variant its motion, not a distinct texture.
  movingSaw: 'saw-spin',
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

// Exported so decorative saws outside a level (MainMenu's backdrop) can
// play the same animation without duplicating its frame/rate definition.
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
  object: LevelObject
): Phaser.GameObjects.Sprite | null {
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
  const sprite = scene.add
    .sprite(object.x, object.y, textureKey)
    .setOrigin(originX, originY);
  scene.physics.add.existing(sprite, !DYNAMIC_BODY_TYPES.has(object.type));

  const spinAnim = SPIN_ANIM_BY_TYPE[object.type];
  if (spinAnim) {
    ensureHazardAnims(scene);
    sprite.play(spinAnim);
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
