import { GRID_CELL_SIZE, GROUND_TOP_Y } from './constants';
import { isDraftObject, isSurfaceType, type DraftObject } from './editorApi';

// Wire contract for GET /api/editor/seeds — the built-in levels a
// moderator can open in the editor and copy back out as seedLevels.ts code.
// Everyone else gets an empty list.
export type SeedLevelForEditor = {
  levelId: string;
  title: string;
  objects: DraftObject[];
  verificationTimeMs: number;
};

export type SeedLevelsResponse = {
  levels: SeedLevelForEditor[];
};

function isSeedLevelForEditor(value: unknown): value is SeedLevelForEditor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'verificationTimeMs' in value &&
    typeof value.verificationTimeMs === 'number' &&
    'objects' in value &&
    Array.isArray(value.objects) &&
    value.objects.every(isDraftObject)
  );
}

export function isSeedLevelsResponse(value: unknown): value is SeedLevelsResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levels' in value &&
    Array.isArray(value.levels) &&
    value.levels.every(isSeedLevelForEditor)
  );
}

// Built-in levels were hand-placed, so many objects sit between the
// editor's grid cells, where Select can't pick them. Opening one in the
// editor moves each hazard, power-up and marker onto its nearest cell (at
// most half a cell). Ground and platforms stay put, since nudging them
// would change gap widths.
export function snapSeedObjectsToGrid(objects: DraftObject[]): DraftObject[] {
  const half = GRID_CELL_SIZE / 2;
  return objects.map((o) =>
    isSurfaceType(o.type)
      ? o
      : {
          ...o,
          x: Math.round((o.x - half) / GRID_CELL_SIZE) * GRID_CELL_SIZE + half,
          y: GROUND_TOP_Y - Math.round((GROUND_TOP_Y - o.y) / GRID_CELL_SIZE) * GRID_CELL_SIZE,
        }
  );
}

// Single-quoted, to match the rest of seedLevels.ts.
function quoted(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function yExpression(y: number): string {
  if (y === GROUND_TOP_Y) return 'GROUND_TOP_Y';
  const offset = GROUND_TOP_Y - y;
  return offset > 0 ? `GROUND_TOP_Y - ${offset}` : `GROUND_TOP_Y + ${-offset}`;
}

// A level as code to paste over its definition in server/core/seedLevels.ts.
// Runs of side-by-side ground tiles on the ground line collapse back into
// groundStrip() calls; everything else is one placed() line, ids kept so
// per-object stats stay attached.
export function seedLevelCode(
  levelId: string,
  objects: DraftObject[],
  verificationTimeMs: number
): string {
  const groundTiles = objects
    .filter((o) => o.type === 'ground' && o.y === GROUND_TOP_Y)
    .sort((a, b) => a.x - b.x);
  const strips: { startX: number; count: number }[] = [];
  let lastX: number | undefined;
  for (const tile of groundTiles) {
    const last = strips.at(-1);
    if (last && lastX !== undefined && tile.x - lastX === GRID_CELL_SIZE) {
      last.count++;
    } else if (tile.x !== lastX) {
      strips.push({ startX: tile.x - GRID_CELL_SIZE / 2, count: 1 });
    }
    lastX = tile.x;
  }
  const lines = strips.map(
    (s) => `    ...groundStrip(${s.startX}, ${s.count * GRID_CELL_SIZE}),`
  );
  const others = objects
    .filter((o) => !(o.type === 'ground' && o.y === GROUND_TOP_Y))
    .sort((a, b) => a.x - b.x || b.y - a.y);
  for (const o of others) {
    lines.push(
      `    placed(${quoted(o.id)}, ${quoted(o.type)}, ${o.x}, ${yExpression(o.y)}),`
    );
  }
  return [
    `// ${levelId}`,
    `level(`,
    `  ${quoted(levelId)},`,
    `  [`,
    ...lines,
    `  ],`,
    `  ${verificationTimeMs}`,
    `)`,
  ].join('\n');
}
