import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../shared/types';
import { buildCoursePreview, isCoursePreview } from '../../shared/coursePreview';
import { renderCoursePreviewSvg } from '../../shared/coursePreviewSvg';

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

await test('preview svg fits the strip width for very wide and very short levels', () => {
  for (const width of [600, 5400]) {
    const preview = buildCoursePreview(levelOf([...groundTiles(0, width), obj('s', 'spawn', 80), obj('f', 'finish', width - 60), obj('c', 'saw', width / 2)]));
    const svg = renderCoursePreviewSvg(preview, 360, 30);
    assert.match(svg, /^<svg [^>]*width="360" height="30"/);
    for (const m of svg.matchAll(/(?:x|cx)="(-?[\d.]+)"/g)) {
      const x = Number(m[1]);
      assert.ok(x >= 0 && x <= 360, `x ${x} out of strip`);
    }
    assert.match(svg, /<circle [^>]*r="3.5"/, 'hazard markers keep a fixed on-screen size');
  }
});

await test('preview svg contains only numeric geometry (no injected text)', () => {
  const svg = renderCoursePreviewSvg({ width: 100, ground: [[0, 100]], platforms: [], hazards: [{ x: 50, y: 480, type: 'candle' }], spawnX: 0, finishX: 90 }, 200, 30);
  assert.equal(svg.includes('<text'), false);
});
