import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../shared/types';
import { buildCoursePreview, isCoursePreview } from '../../shared/coursePreview';

export function obj(id: string, type: ObjectType, x: number, y = GROUND_TOP_Y, addedBy = SEED_AUTHOR): LevelObject {
  return { id, type, x, y, properties: {}, addedBy, addedInVersion: 1 };
}
export function groundTiles(fromX: number, toX: number): LevelObject[] {
  const tiles: LevelObject[] = [];
  for (let x = fromX; x < toX; x += GRID_CELL_SIZE) tiles.push(obj(`g${x}`, 'ground', x + GRID_CELL_SIZE / 2));
  return tiles;
}
export function levelOf(objects: LevelObject[]): LevelVersion {
  return { levelId: 'l', version: 1, parentVersion: null, objects, contributorUsername: SEED_AUTHOR, verificationTimeMs: 1, createdAt: 0 };
}

await test('course preview merges ground into spans and keeps gaps', () => {
  const preview = buildCoursePreview(levelOf([
    ...groundTiles(0, 600), ...groundTiles(720, 1200),
    obj('s', 'spawn', 80), obj('f', 'finish', 1140), obj('c', 'candle', 400),
    obj('p', 'platform', 900, GROUND_TOP_Y - 120), obj('sh', 'shield', 300),
  ]));
  assert.deepEqual(preview.ground, [[0, 600], [720, 1200]]);
  assert.deepEqual(preview.hazards, [{ x: 400, y: GROUND_TOP_Y, type: 'candle' }]);
  assert.deepEqual(preview.platforms, [{ x: 900, y: GROUND_TOP_Y - 120 }]);
  assert.equal(preview.spawnX, 80);
  assert.equal(preview.finishX, 1140);
  assert.equal(preview.width, 1200);
  assert.ok(isCoursePreview(preview));
});

await test('course preview guard rejects malformed shapes', () => {
  assert.equal(isCoursePreview({}), false);
  assert.equal(isCoursePreview({ width: 1, ground: [[0]], platforms: [], hazards: [], spawnX: 0, finishX: 0 }), false);
});
