import * as Phaser from 'phaser';
import { GRID_CELL_SIZE } from '../../../shared/constants';
import {
  FINISH_TRIGGER_HEIGHT_PX,
  MOVING_PLATFORM_AMPLITUDE_PX,
  MOVING_PLATFORM_PERIOD_MS,
} from '../constants';
import type {
  LevelObject,
  LevelVersion,
  ObjectType,
} from '../../../shared/types';
import {
  categoryOf,
  oscillationFor,
  renderLevelObject,
} from '../objects/ObjectRegistry';
import { applyOutlineGlow } from './Juice';

export type LoadedLevel = {
  spawn: { x: number; y: number };
  levelWidth: number;
  // Every moving hazard's and moving platform's tween, exposed so
  // GameScene can scale their playback speed for Slow Time (spec section
  // 21) without touching the run timer — a platform slowing down too
  // keeps it rideable instead of stranding the player mid-jump.
  movingObjectTweens: Phaser.Tweens.Tween[];
  resetMovingObjects: () => void;
  // Power-up pickups, exposed so GameScene can bring them back on a
  // same-scene restart (spec section 30 reuses the scene/world, it doesn't
  // reload the level) — a power-up collected once shouldn't be gone for
  // every subsequent attempt at the same run.
  powerUpImages: Phaser.GameObjects.Sprite[];
  // The visible finish bell (VerificationService guarantees exactly one
  // per level), exposed so GameScene can play the hit/ringing/success
  // texture swap on it from onFinishReached — undefined for level data that
  // (invalidly) has none, rather than throwing.
  finishSprite: Phaser.GameObjects.Sprite | undefined;
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
  let finishSprite: Phaser.GameObjects.Sprite | undefined;
  const movementResets: (() => void)[] = [];
  // Static groups query Arcade's spatial index instead of testing every
  // tile/hazard with a separate collider on every physics step.
  const solids = scene.physics.add.staticGroup();
  const hazards = scene.physics.add.staticGroup();
  const pickups = scene.physics.add.staticGroup();
  const finishes = scene.physics.add.staticGroup();
  const sourceObjects = new Map<Phaser.GameObjects.Sprite, LevelObject>();
  scene.physics.add.collider(player, solids);
  scene.physics.add.overlap(player, hazards, (_player, target) => {
    if (!(target instanceof Phaser.GameObjects.Sprite)) return;
    const object = sourceObjects.get(target);
    if (object) callbacks.onHazardHit(object.id);
  });
  scene.physics.add.overlap(player, pickups, (_player, target) => {
    if (!(target instanceof Phaser.GameObjects.Sprite)) return;
    const object = sourceObjects.get(target);
    if (!object) return;
    setPowerUpAvailable(target, false);
    callbacks.onPowerUpCollected(object.type);
  });
  scene.physics.add.overlap(player, finishes, callbacks.onFinishReached);

  // Ground and platform tiles auto-tile within their own type only (a
  // ground tile sitting beside a platform tile doesn't cap either one) —
  // and only against other *static* tiles of that type. A movingPlatform
  // tweens away from wherever it's authored, so treating its start
  // position as a fixed neighbor would pick an end-cap texture that stops
  // matching the moment it moves.
  const groundPositions = new Set<string>();
  const platformPositions = new Set<string>();
  for (const object of levelVersion.objects) {
    if (object.type === 'ground') {
      groundPositions.add(`${Math.round(object.x)}:${Math.round(object.y)}`);
    } else if (object.type === 'platform') {
      platformPositions.add(`${Math.round(object.x)}:${Math.round(object.y)}`);
    }
  }
  function neighborsWithin(positions: Set<string>, object: LevelObject) {
    return {
      left: positions.has(
        `${Math.round(object.x - GRID_CELL_SIZE)}:${Math.round(object.y)}`
      ),
      right: positions.has(
        `${Math.round(object.x + GRID_CELL_SIZE)}:${Math.round(object.y)}`
      ),
    };
  }
  function tilesetNeighborsOf(object: LevelObject) {
    return neighborsWithin(
      object.type === 'ground' ? groundPositions : platformPositions,
      object
    );
  }

  // Registers both halves of a moving object at once — the tween itself and
  // the closure that resets it (position, carried velocity, collision
  // bounds) for a same-scene restart — so the two arrays can never drift out
  // of sync the way an index captured before the switch and read back after
  // it could.
  function registerMovingTween(
    tween: Phaser.Tweens.Tween,
    rendered: Phaser.GameObjects.Sprite,
    object: LevelObject
  ): void {
    movingObjectTweens.push(tween);
    movementResets.push(() => {
      tween.timeScale = 1;
      tween.restart();
      rendered.setPosition(object.x, object.y);
      if (rendered.body instanceof Phaser.Physics.Arcade.Body) {
        // Clear derived carry velocity as well as the platform's position.
        rendered.body.reset(object.x, object.y);
      } else if (rendered.body instanceof Phaser.Physics.Arcade.StaticBody) {
        rendered.body.updateFromGameObject();
      }
    });
  }

  for (const object of levelVersion.objects) {
    maxX = Math.max(maxX, object.x);

    if (object.type === 'spawn') {
      spawn = { x: object.x, y: object.y };
      continue;
    }

    const rendered =
      object.type === 'ground' || object.type === 'platform'
        ? renderLevelObject(scene, object, tilesetNeighborsOf(object))
        : renderLevelObject(scene, object);
    if (!rendered) {
      continue;
    }
    sourceObjects.set(rendered, object);

    switch (categoryOf(object.type)) {
      case 'solid':
        if (object.type === 'movingPlatform') {
          scene.physics.add.collider(player, rendered);
        } else {
          solids.add(rendered);
        }
        if (object.type === 'movingPlatform') {
          // Unlike movingSaw's static body (fine for overlap-only hazard
          // detection), a rideable collider needs a *dynamic* body so
          // Arcade Physics computes real push/carry velocity from the
          // tween's position changes each frame instead of just resyncing
          // static collision bounds — `setDirectControl()` is exactly
          // Phaser 4's built-in mechanism for "this body's position is
          // driven externally, derive velocity from it". Gravity is already
          // off (ObjectRegistry.renderLevelObject disables it for every
          // dynamic body at creation) — only immovable/direct-control are
          // this branch's own concern.
          if (rendered.body instanceof Phaser.Physics.Arcade.Body) {
            rendered.body.setImmovable(true);
            rendered.body.setDirectControl(true);
          }
          registerMovingTween(
            scene.tweens.add({
              targets: rendered,
              x: object.x + MOVING_PLATFORM_AMPLITUDE_PX,
              duration: MOVING_PLATFORM_PERIOD_MS,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
            }),
            rendered,
            object
          );
        }
        break;
      case 'hazard': {
        const oscillation = oscillationFor(object.type);
        if (oscillation) {
          const axisTarget =
            oscillation.axis === 'x'
              ? { x: object.x + oscillation.amplitude }
              : { y: object.y + oscillation.amplitude };
          registerMovingTween(
            scene.tweens.add({
              targets: rendered,
              ...axisTarget,
              duration: oscillation.periodMs,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
              // A static body's collision bounds don't follow its
              // GameObject transform on their own, so each tween step has
              // to resync it by hand.
              onUpdate: () => {
                if (rendered.body instanceof Phaser.Physics.Arcade.StaticBody) {
                  rendered.body.updateFromGameObject();
                }
              },
            }),
            rendered,
            object
          );
        }
        hazards.add(rendered);
        break;
      }
      case 'finish': {
        // Overlap against the visible trophy sprite alone (only 64px tall,
        // flush with the ground) lets a well-timed jump clear it entirely —
        // the player then keeps auto-running past it, off the end of the
        // level, and falls to their death instead of finishing. A taller
        // invisible sensor at the same x/width, anchored to the same
        // ground baseline, catches every pass regardless of jump height.
        const sensor = scene.add.zone(
          object.x,
          object.y - FINISH_TRIGGER_HEIGHT_PX / 2,
          rendered.displayWidth,
          FINISH_TRIGGER_HEIGHT_PX
        );
        scene.physics.add.existing(sensor, true);
        finishes.add(sensor);
        applyOutlineGlow(rendered, 0x39ff88, 6);
        finishSprite = rendered;
        break;
      }
      case 'powerup':
        powerUpImages.push(rendered);
        pickups.add(rendered);
        applyOutlineGlow(rendered, 0xffffff, 4);
        break;
      default:
        break;
    }
  }

  return {
    resetMovingObjects: () => {
      for (const reset of movementResets) reset();
    },
    spawn,
    levelWidth: maxX + LEVEL_WIDTH_MARGIN,
    movingObjectTweens,
    powerUpImages,
    finishSprite,
  };
}
