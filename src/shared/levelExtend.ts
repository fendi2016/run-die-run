import { EDITOR_MAX_COLUMNS, GRID_CELL_SIZE, GROUND_TOP_Y } from './constants';
import type { DraftObject } from './editorApi';

// How many tiles one tap of "Extend Level" appends (both the base editor
// and the curse flow use this same chunk size — see EditorController
// .extendLevel and CurseScene's extend button). Re-tappable, so the actual
// extension length is just however many multiples of this the player
// wants, up to the level's existing hard width cap (EDITOR_MAX_COLUMNS).
export const LEVEL_EXTEND_CHUNK_TILES = 8;

export type LevelExtension = {
  groundTiles: DraftObject[];
  finish: DraftObject;
};

// Ground/platform tiles are authored at cell *centers*
// (column * GRID_CELL_SIZE + GRID_CELL_SIZE/2 — see seedLevels.ts's
// groundStrip and GridSystem's boardGridConfig, whose grid origin is
// offset by exactly GRID_CELL_SIZE/2 for the same reason), never at raw
// multiples of GRID_CELL_SIZE. Converting to/from column indices up front
// avoids leaking that half-cell offset into every call site below.
function xToColumn(x: number): number {
  return Math.round((x - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE);
}

function columnToX(column: number): number {
  return column * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
}

// -1 (one column before the first) when there's no ground yet, so
// "the next column after this" still lands on column 0, the same
// left-aligned start groundStrip itself uses for a level authored from
// scratch — not on some arbitrary mid-grid column.
function rightmostGroundColumn(
  objects: readonly { type: string; x: number }[]
): number {
  let max = -1;
  for (const object of objects) {
    if (object.type !== 'ground') {
      continue;
    }
    const column = xToColumn(object.x);
    if (column > max) {
      max = column;
    }
  }
  return max;
}

// How many extension tiles (counted from the level's current rightmost
// ground tile, same reference point computeLevelExtension uses) are needed
// for a new chunk of ground to actually reach world-x `x`. Used to
// auto-grow a curse's pending extension when the player places their
// object out past the level's current end, rather than only growing on an
// explicit "Extend Level" tap.
export function tilesNeededToReach(
  objects: readonly DraftObject[],
  x: number
): number {
  return Math.max(0, xToColumn(x) - rightmostGroundColumn(objects));
}

// Deterministic, side-effect-free: given the level's current objects and a
// tile count, computes the ground fill + relocated finish for extending the
// level by that many tiles past its current rightmost ground tile. Called
// from both the client (live preview while placing/proving a curse, or
// building in the base editor) and the server (curse propose/publish
// recompute this themselves from the client's requested tile count rather
// than trusting client-sent positions — same "server never trusts a
// client-computed result" posture as run verification).
//
// `tiles` is a request, not a guarantee — clamped to whatever room remains
// under EDITOR_MAX_COLUMNS. Returns undefined if there's no room at all
// (the level is already at its max width), so callers can tell "nothing to
// extend" apart from "extended by 0 tiles" without checking array length.
export function computeLevelExtension(
  objects: readonly DraftObject[],
  tiles: number,
  makeGroundId: () => string,
  makeFinishId: () => string
): LevelExtension | undefined {
  const startColumn = rightmostGroundColumn(objects) + 1;
  const lastColumn = EDITOR_MAX_COLUMNS - 1;
  const roomTiles = lastColumn - startColumn + 1;
  const clampedTiles = Math.max(0, Math.min(Math.floor(tiles), roomTiles));
  if (clampedTiles <= 0) {
    return undefined;
  }

  const groundTiles: DraftObject[] = [];
  for (let i = 0; i < clampedTiles; i++) {
    groundTiles.push({
      id: makeGroundId(),
      type: 'ground',
      x: columnToX(startColumn + i),
      y: GROUND_TOP_Y,
    });
  }

  const existingFinish = objects.find((o) => o.type === 'finish');
  return {
    groundTiles,
    finish: {
      id: existingFinish?.id ?? makeFinishId(),
      type: 'finish',
      x: columnToX(startColumn + clampedTiles - 1),
      y: GROUND_TOP_Y,
    },
  };
}
