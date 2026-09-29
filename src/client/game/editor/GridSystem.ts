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
  'brickBlock',
  'stoneBlock',
  'crateBlock',
  'grassBlock',
  'sandBlock',
  'metalBlock',
  'bridge',
  'saw',
  'movingSaw',
  'candle',
  'bat',
  'ghost',
  'spikes',
  'cannon',
  'ceilingSpikes',
  'spikeMine',
  'electricMine',
  'mace',
  'crusher',
  'movingPlatform',
  'shield',
  'speedBoost',
  'wings',
  'stopwatch',
  'star',
  'spawn',
  'finish',
] as const;
export type PlaceableObjectType = (typeof PLACEABLE_TYPES)[number];
export type EditorTool = 'select' | 'erase' | PlaceableObjectType;

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

// Design-system ink/paper/rule colors, mirrored here as numeric hex for
// Phaser Graphics draw calls — CSS custom properties (:root in game.css)
// aren't reachable from canvas drawing, so these are kept in sync with
// --ink/--rule-blue/--accent/--paper by hand.
export const INK_COLOR = 0x2b2b2b;
export const RULE_BLUE_COLOR = 0x3d6ea5;
export const ACCENT_COLOR = 0xe53935;
export const PAPER_COLOR = 0xfbf8ef;

// Graph-paper grid: thin, subdued notebook-blue lines with a heavier rule
// every few cells (mimicking real graph paper's bolder major gridlines),
// instead of a flat dark-mode-tool grid.
const GRID_MINOR_ALPHA = 0.22;
const GRID_MAJOR_ALPHA = 0.42;
const GRID_MAJOR_EVERY = 5;
const GROUND_LINE_ALPHA = 0.85;

// Redrawn on every scroll/zoom change rather than pre-baked once, so it
// only ever draws the columns actually in view — cheap at this object
// count and avoids a separate "did the viewport change" cache.
export function drawGrid(
  graphics: Phaser.GameObjects.Graphics,
  viewLeft: number,
  viewRight: number
): void {
  graphics.clear();

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
    const isMajor = col % GRID_MAJOR_EVERY === 0;
    graphics.lineStyle(
      isMajor ? 1.5 : 1,
      RULE_BLUE_COLOR,
      isMajor ? GRID_MAJOR_ALPHA : GRID_MINOR_ALPHA
    );
    graphics.lineBetween(x, top, x, bottom);
  }

  for (let row = 1; row < EDITOR_MAX_ROWS; row++) {
    const y = GROUND_TOP_Y - row * GRID_CELL_SIZE;
    const rowFromGround = EDITOR_MAX_ROWS - row;
    const isMajor = rowFromGround % GRID_MAJOR_EVERY === 0;
    graphics.lineStyle(
      isMajor ? 1.5 : 1,
      RULE_BLUE_COLOR,
      isMajor ? GRID_MAJOR_ALPHA : GRID_MINOR_ALPHA
    );
    graphics.lineBetween(clampedLeft, y, clampedRight, y);
  }
  graphics.lineStyle(1, RULE_BLUE_COLOR, GRID_MINOR_ALPHA);
  graphics.lineBetween(clampedLeft, bottom, clampedRight, bottom);

  // The ground surface itself is drawn as a bold ink line, distinct from the
  // faint blue reference grid above it — it's the one line that actually
  // matters for "where do I tap to place something," so it shouldn't look
  // like just another grid line.
  graphics.lineStyle(3, INK_COLOR, GROUND_LINE_ALPHA);
  graphics.lineBetween(clampedLeft, GROUND_TOP_Y, clampedRight, GROUND_TOP_Y);
}

// A small deterministic "wobble" derived from a numeric seed, in the range
// [-amplitude, amplitude]. Deterministic (not Math.random()) so redrawing
// the same outline at the same position never jitters between redraws —
// only the shape itself looks hand-drawn, the rendering doesn't.
function wobble(seed: number, amplitude: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * amplitude;
}

// An ink-style "sketched twice" rectangle outline — two overlapping passes,
// each with a small per-corner wobble — standing in for a neon dev-tool
// selection box. Used for the editor's selection outline and the curse
// flow's pending-placement outline.
export function drawSketchRect(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha = 1,
  lineWidth = 3
): void {
  const amplitude = 2;
  graphics.lineStyle(lineWidth, color, alpha);
  for (let pass = 0; pass < 2; pass++) {
    const seed = x * 7.13 + y * 11.7 + pass * 91.3;
    const topLeftX = x + wobble(seed + 1, amplitude);
    const topLeftY = y + wobble(seed + 2, amplitude);
    const topRightX = x + width + wobble(seed + 3, amplitude);
    const topRightY = y + wobble(seed + 4, amplitude);
    const bottomRightX = x + width + wobble(seed + 5, amplitude);
    const bottomRightY = y + height + wobble(seed + 6, amplitude);
    const bottomLeftX = x + wobble(seed + 7, amplitude);
    const bottomLeftY = y + height + wobble(seed + 8, amplitude);
    graphics.beginPath();
    graphics.moveTo(topLeftX, topLeftY);
    graphics.lineTo(topRightX, topRightY);
    graphics.lineTo(bottomRightX, bottomRightY);
    graphics.lineTo(bottomLeftX, bottomLeftY);
    graphics.closePath();
    graphics.strokePath();
  }
}
