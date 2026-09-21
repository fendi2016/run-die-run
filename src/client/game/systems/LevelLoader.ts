import * as Phaser from 'phaser';
import {
  MOVING_PLATFORM_AMPLITUDE_PX,
  MOVING_PLATFORM_PERIOD_MS,
  MOVING_SAW_AMPLITUDE_PX,
  MOVING_SAW_PERIOD_MS,
} from '../constants';
import type { LevelVersion, ObjectType } from '../../../shared/types';
import { categoryOf, renderLevelObject } from '../objects/ObjectRegistry';
import { applyOutlineGlow } from './Juice';

export type LoadedLevel = {
  spawn: { x: number; y: number };
  levelWidth: number;
  // Every moving hazard's and moving platform's tween, exposed so
  // GameScene can scale their playback speed for Slow Time (spec section
  // 21) without touching the run timer — a platform slowing down too
  // keeps it rideable instead of stranding the player mid-jump.
  movingObjectTweens: Phaser.Tweens.Tween[];
  // Power-up pickups, exposed so GameScene can bring them back on a
  // same-scene restart (spec section 30 reuses the scene/world, it doesn't
  // reload the level) — a power-up collected once shouldn't be gone for
  // every subsequent attempt at the same run.
  powerUpImages: Phaser.GameObjects.Sprite[];
};

export type LevelLoaderCallbacks = {
  onHazardHit: (objectId: string) => void;
  onFinishReached: () => void;
  onPowerUpCollected: (type: ObjectType) => void;
};

const DEFAULT_SPAWN = { x: 80, y: 0 };
// Trailing margin past the rightmost object so the camera doesn't clamp
// exactly on the finish portal's edge.
const LEVEL_WIDTH_MARGIN = 200;

// A power-up is a one-shot pickup per attempt, not a one-shot pickup ever —
// `setPowerUpAvailable(false)` hides it and disables its body on collect,
// `setPowerUpAvailable(true)` restores both for the next attempt. The body
// was attached via `physics.add.existing` rather than `physics.add.sprite`,
// so it doesn't get Arcade's own `disableBody`/`enableBody` helpers — this
// does the same thing by hand.
export function setPowerUpAvailable(
  sprite: Phaser.GameObjects.Sprite,
  available: boolean
): void {
  sprite.setVisible(available);
  if (sprite.body instanceof Phaser.Physics.Arcade.StaticBody) {
    sprite.body.enable = available;
  }
}

// Builds the Phaser world for one LevelVersion by walking its objects
// through the ObjectRegistry, wiring collider/overlap against `player`
// based on each object's category. Callers never touch object types
// directly — that's entirely the registry's job (spec section 11).
export function loadLevel(
  scene: Phaser.Scene,
  levelVersion: LevelVersion,
  player: Phaser.Physics.Arcade.Sprite,
  callbacks: LevelLoaderCallbacks
): LoadedLevel {
  let spawn = DEFAULT_SPAWN;
  let maxX = 0;
  const movingObjectTweens: Phaser.Tweens.Tween[] = [];
  const powerUpImages: Phaser.GameObjects.Sprite[] = [];

  for (const object of levelVersion.objects) {
    maxX = Math.max(maxX, object.x);

    if (object.type === 'spawn') {
      spawn = { x: object.x, y: object.y };
      continue;
    }

    const rendered = renderLevelObject(scene, object);
    if (!rendered) {
      continue;
    }

    switch (categoryOf(object.type)) {
      case 'solid':
        scene.physics.add.collider(player, rendered);
        if (object.type === 'movingPlatform') {
          // Unlike movingSaw's static body (fine for overlap-only hazard
          // detection), a rideable collider needs a *dynamic* body so
          // Arcade Physics computes real push/carry velocity from the
          // tween's position changes each frame instead of just resyncing
          // static collision bounds — `setDirectControl()` is exactly
          // Phaser 4's built-in mechanism for "this body's position is
          // driven externally, derive velocity from it".
          if (rendered.body instanceof Phaser.Physics.Arcade.Body) {
            rendered.body.setImmovable(true);
            rendered.body.setAllowGravity(false);
            rendered.body.setDirectControl(true);
          }
          movingObjectTweens.push(
            scene.tweens.add({
              targets: rendered,
              x: object.x + MOVING_PLATFORM_AMPLITUDE_PX,
              duration: MOVING_PLATFORM_PERIOD_MS,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
            })
          );
        }
        break;
      case 'hazard':
        if (object.type === 'movingSaw') {
          movingObjectTweens.push(
            scene.tweens.add({
              targets: rendered,
              x: object.x + MOVING_SAW_AMPLITUDE_PX,
              duration: MOVING_SAW_PERIOD_MS,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
              onUpdate: () => {
                if (rendered.body instanceof Phaser.Physics.Arcade.StaticBody) {
                  rendered.body.updateFromGameObject();
                }
              },
            })
          );
        }
        scene.physics.add.overlap(player, rendered, () =>
          callbacks.onHazardHit(object.id)
        );
        break;
      case 'finish':
        scene.physics.add.overlap(player, rendered, callbacks.onFinishReached);
        applyOutlineGlow(rendered, 0x39ff88, 6);
        break;
      case 'powerup':
        powerUpImages.push(rendered);
        scene.physics.add.overlap(player, rendered, () => {
          setPowerUpAvailable(rendered, false);
          callbacks.onPowerUpCollected(object.type);
        });
        applyOutlineGlow(rendered, 0xffffff, 4);
        break;
      default:
        break;
    }
  }

  return {
    spawn,
    levelWidth: maxX + LEVEL_WIDTH_MARGIN,
    movingObjectTweens,
    powerUpImages,
  };
}
