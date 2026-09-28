import { GRID_CELL_SIZE, GROUND_TOP_Y } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelObject, ObjectType } from './types';

// The three traps offered to a first-time curser, and where to suggest
// placing one. Suggestions are hints only — a curse can still go anywhere.
export const GUIDED_CURSE_TYPES: ObjectType[] = ['candle', 'saw', 'ghost'];

// Up to `count` spread-out ground cells that make a fair first trap: open
// ground (ground on both sides, so not a gap edge), a few cells clear of
// the spawn and finish, and two cells clear of any trap or platform.
// Fewer, or none, on a cramped level.
export function suggestCurseCells(
  objects: LevelObject[],
  count: number
): { x: number; y: number }[] {
  const cell = GRID_CELL_SIZE;
  const spawnX = objects.find((o) => o.type === 'spawn')?.x;
  const finishX = objects.find((o) => o.type === 'finish')?.x;
  if (spawnX === undefined || finishX === undefined) return [];
  const groundXs = new Set(objects.filter((o) => o.type === 'ground').map((o) => o.x));
  const others = objects.filter(
    (o) => HAZARD_TYPES.has(o.type) || o.type === 'platform' || o.type === 'movingPlatform'
  );
  const candidates = [...groundXs]
    .sort((a, b) => a - b)
    .filter(
      (x) =>
        x >= spawnX + 4 * cell &&
        x <= finishX - 3 * cell &&
        groundXs.has(x - cell) &&
        groundXs.has(x + cell) &&
        others.every((o) => Math.abs(o.x - x) > 2 * cell)
    );
  const n = Math.min(count, candidates.length);
  const picks: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = candidates[Math.floor(((i + 0.5) * candidates.length) / n)];
    if (x !== undefined && picks.every((p) => Math.abs(p - x) >= 4 * cell)) picks.push(x);
  }
  return picks.map((x) => ({ x, y: GROUND_TOP_Y }));
}
