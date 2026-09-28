import * as Phaser from 'phaser';
import { GRID_CELL_SIZE, GROUND_TOP_Y, LOGICAL_HEIGHT } from '../../../shared/constants';
import type { LevelObject } from '../../../shared/types';

// Set dressing for a run, so gameplay sits on the same drawn-in notebook
// page as the title screen instead of a bare ruled sheet: paper grain, a
// margin rule at the start, faint graphite doodles and half-erased
// sketches in the sky, and pencil hatching + edge detail on the ground.
// Everything here is cosmetic — no bodies, no input — and deliberately
// faint and grey so hazards, which are the only saturated ink on the
// page, stay visually dominant.

const GRAIN_KEY = 'paper-grain';
const GRAPHITE = 0x5d6474;
const INK = 0x2b2b2b;
const MARGIN_RED = 0xe06666;

// Layering: level-background (-1) < grain < doodles < death markers (-0.5)
// < spawn tombstone (-0.25) < finish gate (-0.1) < ground tiles < ground
// detail < player and hazards (0).
const GRAIN_DEPTH = -0.95;
const DOODLE_DEPTH = -0.9;
export const GROUND_TILE_DEPTH = -0.08;
const GROUND_DETAIL_DEPTH = -0.05;

// Doodles stay out of the band a run actually happens in: a jump peaks
// ~107px over the ground and floaters drift ~130px up, so the sky band ends
// well above that. Platforms can sit higher, which is why doodles are thin
// graphite at low alpha rather than anything that could read as terrain.
const DOODLE_TOP_Y = 30;
const DOODLE_BOTTOM_Y = GROUND_TOP_Y - 190;

type Rng = () => number;

// Deterministic per level, so a restart (or another player) sees the same
// page rather than doodles reshuffling on every attempt.
function seededRng(seedText: string): Rng {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  }
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

type Point = { x: number; y: number };

// A pencil line: every vertex wobbles a little and the stroke is drawn
// twice, slightly offset, the way a quick sketch doubles back on itself.
function sketch(g: Phaser.GameObjects.Graphics, points: Point[], rng: Rng, wobble = 1.2, closed = false): void {
  for (let pass = 0; pass < 2; pass++) {
    const dx = pass === 0 ? 0 : range(rng, -0.8, 0.8);
    const dy = pass === 0 ? 0 : range(rng, -0.8, 0.8);
    g.beginPath();
    points.forEach((p, i) => {
      const x = p.x + dx + range(rng, -wobble, wobble);
      const y = p.y + dy + range(rng, -wobble, wobble);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    if (closed) g.closePath();
    g.strokePath();
  }
}

function circlePoints(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2, steps = 18): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return points;
}

type Doodle = (g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, rng: Rng) => void;

const cloud: Doodle = (g, x, y, s, rng) => {
  const points: Point[] = [];
  const bumps = [
    { cx: -34, cy: 4, r: 16 },
    { cx: -14, cy: -10, r: 20 },
    { cx: 12, cy: -14, r: 22 },
    { cx: 34, cy: 0, r: 16 },
  ];
  for (const b of bumps) points.push(...circlePoints(x + b.cx * s, y + b.cy * s, b.r * s, b.r * s, Math.PI, Math.PI * 2, 8));
  const start = points[0];
  points.push({ x: x + 50 * s, y: y + 16 * s }, { x: x - 50 * s, y: y + 16 * s });
  if (start) points.push(start);
  sketch(g, points, rng, 1);
};

const star: Doodle = (g, x, y, s, rng) => {
  const points: Point[] = [];
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    points.push({ x: x + Math.cos(a) * 18 * s, y: y + Math.sin(a) * 18 * s });
  }
  sketch(g, points, rng, 1);
};

const spiral: Doodle = (g, x, y, s, rng) => {
  const points: Point[] = [];
  for (let i = 0; i < 44; i++) {
    const a = i * 0.42;
    const r = (2 + i * 0.55) * s;
    points.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  sketch(g, points, rng, 0.6);
};

const sun: Doodle = (g, x, y, s, rng) => {
  sketch(g, circlePoints(x, y, 14 * s, 14 * s), rng, 0.8, true);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + range(rng, -0.1, 0.1);
    sketch(g, [
      { x: x + Math.cos(a) * 20 * s, y: y + Math.sin(a) * 20 * s },
      { x: x + Math.cos(a) * 30 * s, y: y + Math.sin(a) * 30 * s },
    ], rng, 0.6);
  }
};

const heart: Doodle = (g, x, y, s, rng) => {
  const points: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    points.push({
      x: x + 16 * Math.sin(t) ** 3 * s,
      y: y - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s,
    });
  }
  sketch(g, points, rng, 0.8);
};

const bolt: Doodle = (g, x, y, s, rng) => {
  sketch(g, [
    { x: x + 6 * s, y: y - 26 * s },
    { x: x - 10 * s, y: y + 2 * s },
    { x: x + 2 * s, y: y + 2 * s },
    { x: x - 6 * s, y: y + 28 * s },
    { x: x + 14 * s, y: y - 4 * s },
    { x: x + 1 * s, y: y - 4 * s },
    { x: x + 6 * s, y: y - 26 * s },
  ], rng, 0.8);
};

const smiley: Doodle = (g, x, y, s, rng) => {
  sketch(g, circlePoints(x, y, 20 * s, 19 * s), rng, 0.9, true);
  sketch(g, [{ x: x - 7 * s, y: y - 7 * s }, { x: x - 7 * s, y: y - 2 * s }], rng, 0.4);
  sketch(g, [{ x: x + 7 * s, y: y - 7 * s }, { x: x + 7 * s, y: y - 2 * s }], rng, 0.4);
  sketch(g, circlePoints(x, y + 2 * s, 11 * s, 8 * s, 0.3, Math.PI - 0.3, 10), rng, 0.5);
};

const house: Doodle = (g, x, y, s, rng) => {
  sketch(g, [
    { x: x - 22 * s, y: y + 22 * s },
    { x: x - 22 * s, y: y - 4 * s },
    { x: x, y: y - 24 * s },
    { x: x + 22 * s, y: y - 4 * s },
    { x: x + 22 * s, y: y + 22 * s },
    { x: x - 22 * s, y: y + 22 * s },
  ], rng, 1);
  sketch(g, [
    { x: x - 5 * s, y: y + 22 * s },
    { x: x - 5 * s, y: y + 8 * s },
    { x: x + 5 * s, y: y + 8 * s },
    { x: x + 5 * s, y: y + 22 * s },
  ], rng, 0.6);
};

const arrow: Doodle = (g, x, y, s, rng) => {
  const shaft = circlePoints(x, y + 30 * s, 40 * s, 26 * s, Math.PI * 1.15, Math.PI * 1.85, 12);
  sketch(g, shaft, rng, 0.8);
  const tip = shaft[shaft.length - 1];
  if (!tip) return;
  sketch(g, [{ x: tip.x - 12 * s, y: tip.y - 3 * s }, tip, { x: tip.x - 4 * s, y: tip.y + 11 * s }], rng, 0.6);
};

const stickFigure: Doodle = (g, x, y, s, rng) => {
  sketch(g, circlePoints(x, y - 18 * s, 7 * s, 7 * s), rng, 0.5, true);
  sketch(g, [{ x, y: y - 11 * s }, { x, y: y + 8 * s }], rng, 0.5);
  sketch(g, [{ x: x - 11 * s, y: y - 6 * s }, { x, y: y - 2 * s }, { x: x + 12 * s, y: y - 10 * s }], rng, 0.5);
  sketch(g, [{ x: x - 8 * s, y: y + 22 * s }, { x, y: y + 8 * s }, { x: x + 8 * s, y: y + 22 * s }], rng, 0.5);
};

// Tic-tac-toe mid-game: the kind of thing that ends up in every margin.
const ticTacToe: Doodle = (g, x, y, s, rng) => {
  for (const d of [-8, 8]) {
    sketch(g, [{ x: x + d * s, y: y - 24 * s }, { x: x + d * s, y: y + 24 * s }], rng, 0.8);
    sketch(g, [{ x: x - 24 * s, y: y + d * s }, { x: x + 24 * s, y: y + d * s }], rng, 0.8);
  }
  sketch(g, [{ x: x - 20 * s, y: y - 20 * s }, { x: x - 12 * s, y: y - 12 * s }], rng, 0.3);
  sketch(g, [{ x: x - 12 * s, y: y - 20 * s }, { x: x - 20 * s, y: y - 12 * s }], rng, 0.3);
  sketch(g, circlePoints(x, y, 5 * s, 5 * s), rng, 0.3, true);
  sketch(g, [{ x: x + 12 * s, y: y + 12 * s }, { x: x + 20 * s, y: y + 20 * s }], rng, 0.3);
  sketch(g, [{ x: x + 20 * s, y: y + 12 * s }, { x: x + 12 * s, y: y + 20 * s }], rng, 0.3);
};

const DOODLES: Doodle[] = [cloud, star, spiral, sun, heart, bolt, smiley, house, arrow, stickFigure, ticTacToe, cloud];

function pickDoodle(rng: Rng): Doodle {
  return DOODLES[Math.floor(rng() * DOODLES.length)] ?? cloud;
}

// An erased sketch: a wide, very faint smudge with the ghost of the
// drawing still in it — rubbed out, but never quite gone.
function erasedSketch(scene: Phaser.Scene, x: number, y: number, rng: Rng): void {
  const smudge = scene.add.graphics().setDepth(DOODLE_DEPTH);
  smudge.fillStyle(GRAPHITE, 0.045);
  for (let i = 0; i < 5; i++) {
    smudge.fillEllipse(x + range(rng, -26, 26), y + range(rng, -10, 10), range(rng, 50, 90), range(rng, 16, 28));
  }
  const ghost = scene.add.graphics().setDepth(DOODLE_DEPTH);
  ghost.lineStyle(2.4, GRAPHITE, 0.09);
  pickDoodle(rng)(ghost, x, y, range(rng, 1.1, 1.5), rng);
  // A few eraser streaks through it.
  smudge.lineStyle(3, 0xffffff, 0.35);
  for (let i = 0; i < 3; i++) {
    const sx = x + range(rng, -40, 10);
    const sy = y + range(rng, -14, 14);
    smudge.lineBetween(sx, sy, sx + range(rng, 40, 70), sy + range(rng, -8, 8));
  }
}

function ensureGrainTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GRAIN_KEY)) return;
  const size = 256;
  const texture = scene.textures.createCanvas(GRAIN_KEY, size, size);
  if (!texture) return;
  const ctx = texture.getContext();
  const rng = seededRng(GRAIN_KEY);
  // Tooth: fine specks, a few darker, a few lighter than the paper.
  for (let i = 0; i < 2600; i++) {
    const dark = rng() < 0.7;
    ctx.fillStyle = dark ? `rgba(90, 80, 60, ${range(rng, 0.03, 0.08)})` : `rgba(255, 255, 255, ${range(rng, 0.2, 0.5)})`;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
  // Fibres: short faint curved strands.
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.strokeStyle = `rgba(110, 95, 70, ${range(rng, 0.04, 0.08)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + range(rng, -6, 6), y + range(rng, -6, 6), x + range(rng, -12, 12), y + range(rng, -12, 12));
    ctx.stroke();
  }
  texture.refresh();
}

export function drawPaperBackdrop(scene: Phaser.Scene, levelWidth: number, seedText: string): void {
  ensureGrainTexture(scene);
  scene.add
    .tileSprite(0, 0, levelWidth, LOGICAL_HEIGHT, GRAIN_KEY)
    .setOrigin(0, 0)
    .setDepth(GRAIN_DEPTH);

  // The notebook's margin rule, where the page — and the run — begins.
  const margin = scene.add.graphics().setDepth(DOODLE_DEPTH);
  margin.lineStyle(2, MARGIN_RED, 0.45);
  margin.lineBetween(26, 0, 26, LOGICAL_HEIGHT);
  margin.lineStyle(1, MARGIN_RED, 0.3);
  margin.lineBetween(31, 0, 31, LOGICAL_HEIGHT);

  const rng = seededRng(seedText);
  const doodles = scene.add.graphics().setDepth(DOODLE_DEPTH);
  // Starts past the spawn so the tap-to-start view stays calm; spacing is
  // loose enough that most screens hold one or two, never a crowd.
  let x = range(rng, 420, 560);
  while (x < levelWidth - 60) {
    const y = range(rng, DOODLE_TOP_Y + 30, DOODLE_BOTTOM_Y);
    if (rng() < 0.28) {
      erasedSketch(scene, x, y, rng);
    } else {
      doodles.lineStyle(range(rng, 1.6, 2.2), GRAPHITE, range(rng, 0.2, 0.3));
      pickDoodle(rng)(doodles, x, y, range(rng, 0.9, 1.4), rng);
    }
    x += range(rng, 240, 440);
  }
}

// Hatching, tufts and pebbles over each run of ground tiles, so the ground
// reads as drawn rather than an empty white slab. Drawn per tile from the
// level's own ground objects, so gaps stay clean gaps.
export function drawGroundDetail(scene: Phaser.Scene, objects: LevelObject[], seedText: string): void {
  const rng = seededRng(`${seedText}:ground`);
  const g = scene.add.graphics().setDepth(GROUND_DETAIL_DEPTH);
  const half = GRID_CELL_SIZE / 2;
  const tiles = objects
    .filter((o) => o.type === 'ground')
    .sort((a, b) => a.x - b.x);
  const bottom = Math.min(LOGICAL_HEIGHT, GROUND_TOP_Y + GRID_CELL_SIZE);

  for (const tile of tiles) {
    const left = tile.x - half;
    const top = tile.y;

    // Shading band under the lip: diagonal hatching, densest just below
    // the edge and thinning out lower down, like a quick pencil shadow.
    g.lineStyle(1.3, GRAPHITE, 0.26);
    for (let hx = left - 14; hx < left + GRID_CELL_SIZE; hx += 7) {
      const len = range(rng, 9, 15);
      const x0 = Math.max(left + 1, hx);
      const x1 = Math.min(left + GRID_CELL_SIZE - 1, hx + len);
      if (x1 <= x0) continue;
      const y0 = top + 7 + (x0 - hx);
      g.lineBetween(x0, y0, x1, y0 + (x1 - x0) * 0.9);
    }
    // Sparse cross-hatch deeper in.
    g.lineStyle(1, GRAPHITE, 0.14);
    for (let i = 0; i < 3; i++) {
      const hx = left + range(rng, 4, GRID_CELL_SIZE - 16);
      const hy = top + range(rng, 28, 44);
      g.lineBetween(hx, hy, hx + 10, hy - 8);
    }

    // Occasional detail: a pebble, a buried scribble, a crack.
    const roll = rng();
    if (roll < 0.22) {
      g.lineStyle(1.4, INK, 0.45);
      g.strokeEllipse(left + range(rng, 14, 46), Math.min(bottom - 8, top + range(rng, 30, 44)), range(rng, 8, 13), range(rng, 5, 8));
    } else if (roll < 0.34) {
      g.lineStyle(1.2, INK, 0.35);
      const cx = left + range(rng, 12, 40);
      const cy = top + range(rng, 26, 40);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + 6, cy + 5);
      g.lineTo(cx + 3, cy + 11);
      g.lineTo(cx + 10, cy + 16);
      g.strokePath();
    } else if (roll < 0.42) {
      g.fillStyle(INK, 0.35);
      for (let i = 0; i < 3; i++) g.fillCircle(left + range(rng, 10, 50), top + range(rng, 24, 48), range(rng, 1, 1.8));
    }

    // Grass poking up over the lip: a quick zigzag, the way grass gets
    // drawn in a margin, in ink like the rest of the edge.
    if (rng() < 0.4) {
      const tx = left + range(rng, 6, GRID_CELL_SIZE - 24);
      const blades = 2 + Math.floor(rng() * 3);
      const points: Point[] = [{ x: tx, y: top + 1 }];
      for (let i = 0; i < blades; i++) {
        const bx = tx + i * 5;
        points.push({ x: bx + range(rng, 1.5, 4), y: top + 1 - range(rng, 4, 10) }, { x: bx + 5, y: top + 1 });
      }
      g.lineStyle(1.3, INK, 0.6);
      sketch(g, points, rng, 0.3);
    }
  }
}
