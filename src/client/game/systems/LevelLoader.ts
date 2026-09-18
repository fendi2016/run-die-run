import * as Phaser from 'phaser';
import type { LevelVersion } from '../../../shared/types';
import { categoryOf, renderLevelObject } from '../objects/ObjectRegistry';

export type LoadedLevel = {
  spawn: { x: number; y: number };
  levelWidth: number;
};

export type LevelLoaderCallbacks = {
  onHazardHit: () => void;
  onFinishReached: () => void;
};

const DEFAULT_SPAWN = { x: 80, y: 0 };
// Trailing margin past the rightmost object so the camera doesn't clamp
// exactly on the finish portal's edge.
const LEVEL_WIDTH_MARGIN = 200;

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
        break;
      case 'hazard':
        scene.physics.add.overlap(player, rendered, callbacks.onHazardHit);
        break;
      case 'finish':
        scene.physics.add.overlap(player, rendered, callbacks.onFinishReached);
        break;
      default:
        break;
    }
  }

  return { spawn, levelWidth: maxX + LEVEL_WIDTH_MARGIN };
}
