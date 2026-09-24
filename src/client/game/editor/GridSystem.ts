import type * as Phaser from 'phaser';
import {
  EDITOR_MAX_COLUMNS,
  EDITOR_MAX_ROWS,
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
} from '../../../shared/constants';

// The set of object types the base editor (spec section 12) can place.
// Falling Block isn't part of the MVP object set (spec section 39) and
// isn't wired into ObjectRegistry, so it's left out of the palette rather
// than placed as an object that would silently render nothing.
export const PLACEABLE_TYPES = [
  'ground',
  'platform',
  'saw',
  'movingSaw',
  'candle',
  'bat',
  'ghost',
  'movingPlatform',
  'shield',
  'speedBoost',
  'spawn',
  'finish',
] as const;
export type PlaceableObjectType = (typeof PLACEABLE_TYPES)[number];
export type EditorTool = 'select' | PlaceableObjectType;

// Board rows increase downward from the highest editable row. This puts
// the extra tap row below the ground while keeping all board indices >= 0.
export function boardGridConfig(): {
  gridType: 'quadGrid';
  x: number;
  y: number;
  cellWidth: number;
  cellHeight: number;
  type: 'orthogonal';
} {
  return {
    gridType: 'quadGrid',
    x: GRID_CELL_SIZE / 2,
    y: GROUND_TOP_Y - (EDITOR_MAX_ROWS - 1) * GRID_CELL_SIZE,
    cellWidth: GRID_CELL_SIZE,
    cellHeight: GRID_CELL_SIZE,
    type: 'orthogonal',
  };
}

// One extra board row below the ground, never placed on, purely
// to widen the ground row's tap target. Ground tiles are top-anchored at
// GROUND_TOP_Y (rendering *below* it, a full cell deep) while
// hazards/spawn/finish are bottom-anchored at the same y (rendering
// *above* it) — the tile grid's nearest-cell tap picking only credits
// the ground row for the top half of a ground tile's footprint, so tapping
// the tile's bottom half would otherwise fall in unmapped space below the
// board and silently produce no tap event at all. `normalizeBoardRow`
// folds that one buffer row back onto the ground row.
export const EDITOR_BOARD_ROWS = EDITOR_MAX_ROWS + 1;

export function normalizeBoardRow(row: number): number {
  return Math.max(0, Math.min(EDITOR_MAX_ROWS - 1, row));
}

export function clampBoardColumn(col: number): number {
  return Math.max(0, Math.min(EDITOR_MAX_COLUMNS - 1, col));
}

export function levelWidthPx(): number {
  return EDITOR_MAX_COLUMNS * GRID_CELL_SIZE;
}

// Vertical framing for PanZoomCamera: the region the editor/curse camera
// should fit to fill its viewport, as opposed to LOGICAL_HEIGHT (which is
// GameScene's sky-inclusive play area and leaves a large dead band above
// the grid when reused here). One extra cell of headroom above the top
// placeable row mirrors the existing buffer row already reserved below
// the ground line, so the framed content isn't flush against either edge.
export function gridViewTopY(): number {
  return GROUND_TOP_Y - EDITOR_MAX_ROWS * GRID_CELL_SIZE;
}

export function gridViewBottomY(): number {
  return GROUND_TOP_Y + GRID_CELL_SIZE;
}

export function gridViewHeightPx(): number {
  return gridViewBottomY() - gridViewTopY();
}

const GRID_LINE_ALPHA = 0.12;

// Redrawn on every scroll/zoom change rather than pre-baked once, so it
// only ever draws the columns actually in view — cheap at this object
// count and avoids a separate "did the viewport change" cache.
export function drawGrid(
  graphics: Phaser.GameObjects.Graphics,
  viewLeft: number,
  viewRight: number
): void {
  graphics.clear();
  graphics.lineStyle(1, 0xffffff, GRID_LINE_ALPHA);

  const top = GROUND_TOP_Y - (EDITOR_MAX_ROWS - 1) * GRID_CELL_SIZE;
  const bottom = GROUND_TOP_Y + GRID_CELL_SIZE;
  const clampedLeft = Math.max(0, viewLeft);
  const clampedRight = Math.min(levelWidthPx(), viewRight);

  const firstCol = Math.max(0, Math.floor(viewLeft / GRID_CELL_SIZE));
  const lastCol = Math.min(
    EDITOR_MAX_COLUMNS,
    Math.ceil(viewRight / GRID_CELL_SIZE) + 1
  );
  for (let col = firstCol; col <= lastCol; col++) {
    const x = col * GRID_CELL_SIZE;
    graphics.lineBetween(x, top, x, bottom);
  }

  for (let row = 1; row < EDITOR_MAX_ROWS; row++) {
    const y = GROUND_TOP_Y - row * GRID_CELL_SIZE;
    graphics.lineBetween(clampedLeft, y, clampedRight, y);
  }
  graphics.lineBetween(clampedLeft, bottom, clampedRight, bottom);

  // The ground surface itself is drawn bright and thick, distinct from the
  // faint reference grid above it — it's the one line that actually
  // matters for "where do I tap to place something," so it shouldn't look
  // like just another grid line.
  graphics.lineStyle(3, 0x39ff88, 0.6);
  graphics.lineBetween(clampedLeft, GROUND_TOP_Y, clampedRight, GROUND_TOP_Y);
}
