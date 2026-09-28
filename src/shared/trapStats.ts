import { GRID_CELL_SIZE, SEED_AUTHOR } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelObject } from './types';

// Which other players' traps a run got past: fully behind the furthest x
// it reached (a whole cell clear of the trap's center, so dying ON a trap
// never counts as passing it), or every one of them on a clear. A bat's
// or moving saw's start position stands in for where it is.
export function passedHazardIds(
  objects: LevelObject[],
  reachedX: number | 'clear',
  username: string
): string[] {
  return objects
    .filter((o) => HAZARD_TYPES.has(o.type) && o.addedBy !== SEED_AUTHOR && o.addedBy !== username)
    .filter((o) => reachedX === 'clear' || o.x + GRID_CELL_SIZE <= reachedX)
    .map((o) => o.id);
}
