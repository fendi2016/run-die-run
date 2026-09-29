import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../shared/types';
import { buildCoursePreview, isCoursePreview } from '../../shared/coursePreview';
import { renderCoursePreviewSvg } from '../../shared/coursePreviewSvg';
import { passedHazardIds } from '../../shared/trapStats';
import { suggestCurseCells } from '../../shared/curseSuggestions';

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


await test("passes count only other players' traps fully behind the player", () => {
  const objects = [
    obj('a', 'candle', 300, GROUND_TOP_Y, 'bob'),
    obj('b', 'saw', 600, GROUND_TOP_Y, 'bob'),
    obj('mine', 'candle', 200, GROUND_TOP_Y, 'alice'),
    obj('seed', 'candle', 100),
    obj('pw', 'shield', 150, GROUND_TOP_Y, 'bob'),
  ];
  assert.deepEqual(passedHazardIds(objects, 400, 'alice'), ['a']);
  assert.deepEqual(passedHazardIds(objects, 620, 'alice'), ['a'], 'still inside the saw cell');
  assert.deepEqual(passedHazardIds(objects, 'clear', 'alice').sort(), ['a', 'b']);
});


await test('suggestions sit on open ground, away from spawn, finish, gaps and other traps', () => {
  const objects = [...groundTiles(0, 1800), ...groundTiles(1920, 3000),
    obj('s', 'spawn', 90), obj('f', 'finish', 2910), obj('c', 'candle', 1230)];
  const cells = suggestCurseCells(objects, 3);
  assert.equal(cells.length, 3);
  for (const { x, y } of cells) {
    assert.equal(y, GROUND_TOP_Y);
    assert.ok(x >= 90 + 4 * GRID_CELL_SIZE, 'clear of spawn');
    assert.ok(x <= 2910 - 3 * GRID_CELL_SIZE, 'clear of finish');
    assert.ok(Math.abs(x - 1230) > 2 * GRID_CELL_SIZE, 'clear of the existing candle');
    assert.ok(x < 1800 - GRID_CELL_SIZE || x > 1920 + GRID_CELL_SIZE, 'not on a gap edge');
  }
  const [first, second] = cells;
  assert.ok(first && second && second.x - first.x >= 4 * GRID_CELL_SIZE, 'spread out');
});

await test('suggestions degrade to fewer (or none) on a cramped level', () => {
  assert.deepEqual(suggestCurseCells([...groundTiles(0, 480), obj('s', 'spawn', 90), obj('f', 'finish', 420)], 3), []);
  assert.deepEqual(suggestCurseCells([], 3), []);
  const packed = [...groundTiles(0, 1200), obj('s', 'spawn', 90), obj('f', 'finish', 1110),
    ...[390, 510, 630, 750, 870].map((x) => obj(`h${x}`, 'saw', x))];
  assert.deepEqual(suggestCurseCells(packed, 3), []);
});

// Kenney level objects: the new full-cell terrain blocks behave exactly
// like 'ground' and the bridge behaves exactly like 'platform' for every
// consumer of GROUND_LIKE_TYPES/PLATFORM_LIKE_TYPES, not just ObjectRegistry
// — the feed-card course preview and the curse-suggestion "open ground"
// search must not silently drop a level built from the new blocks.
await test('new terrain blocks silhouette like ground/platform in the course preview', () => {
  const preview = buildCoursePreview(levelOf([
    obj('b1', 'brickBlock', 30), obj('b2', 'stoneBlock', 90), obj('b3', 'crateBlock', 150),
    obj('bridge', 'bridge', 300, GROUND_TOP_Y - 120),
    obj('spikes', 'spikes', 210),
    obj('s', 'spawn', 30), obj('f', 'finish', 330),
  ]));
  assert.deepEqual(preview.ground, [[0, 180]]);
  assert.deepEqual(preview.platforms, [{ x: 300, y: GROUND_TOP_Y - 120 }]);
  assert.deepEqual(preview.hazards, [{ x: 210, y: GROUND_TOP_Y, type: 'spikes' }]);
});

await test('suggestions treat the new terrain blocks as open ground', () => {
  const objects = [
    ...groundTiles(0, 600).map((o) => ({ ...o, type: 'brickBlock' as const })),
    obj('s', 'spawn', 90), obj('f', 'finish', 540),
  ];
  const cells = suggestCurseCells(objects, 1);
  assert.equal(cells.length, 1);
});
