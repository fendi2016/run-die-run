import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_CELL_SIZE, GROUND_TOP_Y } from '../../shared/constants';
import type { DraftObject } from '../../shared/editorApi';
import { computeLevelExtension, tilesNeededToReach } from '../../shared/levelExtend';

const x = (column: number) => column * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
const column = (worldX: number) => (worldX - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE;

// Ground ends at column 19; the course carries on over platforms to a
// finish at column 40.
const objects: DraftObject[] = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `g${i}`,
    type: 'ground' as const,
    x: x(i),
    y: GROUND_TOP_Y,
  })),
  { id: 'p1', type: 'platform', x: x(30), y: GROUND_TOP_Y - 2 * GRID_CELL_SIZE },
  { id: 'finish', type: 'finish', x: x(40), y: GROUND_TOP_Y - 2 * GRID_CELL_SIZE },
];

void test('a sabotage extension never pulls the finish closer', () => {
  const extension = computeLevelExtension(objects, 1, () => 'g', () => 'f');
  assert.ok(extension);
  assert.equal(column(extension.finish.x), 41);
  assert.equal(column(extension.groundTiles[0]?.x ?? -1), 41);
});

void test('placing a trap between the ground end and the finish needs no extension', () => {
  assert.equal(tilesNeededToReach(objects, x(25)), 0);
  assert.equal(tilesNeededToReach(objects, x(43)), 3);
});
