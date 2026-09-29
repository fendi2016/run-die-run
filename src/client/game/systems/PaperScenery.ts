import * as Phaser from 'phaser';
import { GRID_CELL_SIZE, GROUND_TOP_Y, LOGICAL_HEIGHT } from '../../../shared/constants';
import type { LevelObject } from '../../../shared/types';

// Set dressing for a run, so gameplay sits in the same drawn world as the
// title screen instead of on a bare ruled sheet: paper grain, a margin
// rule at the start, Kenney Scribble Platformer scenery (CC0 — clouds, a
// far skyline, trees and bushes, the same style as the menu art) in three
// parallax layers, and pencil hatching + edge detail on the ground.
// Everything here is cosmetic — no bodies, no input — and kept light and
// behind the action so hazards stay visually dominant.

const GRAIN_KEY = 'paper-grain';
const GRAPHITE = 0x5d6474;
const INK = 0x2b2b2b;
const MARGIN_RED = 0xe06666;

// Layering: level-background (-1) < grain < clouds < skyline < margin <
// near scenery < death markers (-0.5) < spawn pencil case (-0.25) < finish
// gate (-0.1) < ground tiles < ground detail < player and hazards (0).
const GRAIN_DEPTH = -0.95;
const CLOUD_DEPTH = -0.93;
const SKYLINE_DEPTH = -0.91;
const MARGIN_DEPTH = -0.9;
const NEAR_SCENERY_DEPTH = -0.85;
const SKYLINE_SIZE = 0.62;
export const GROUND_TILE_DEPTH = -0.08;
const GROUND_DETAIL_DEPTH = -0.05;

type Rng = () => number;

// Deterministic per level, so a restart (or another player) sees the same
// page rather than scenery reshuffling on every attempt.
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

export function drawPaperBackdrop(scene: Phaser.Scene, levelWidth: number): void {
  ensureGrainTexture(scene);
  scene.add
    .tileSprite(0, 0, levelWidth, LOGICAL_HEIGHT, GRAIN_KEY)
    .setOrigin(0, 0)
    .setDepth(GRAIN_DEPTH);

  // The notebook's margin rule, where the page — and the run — begins.
  const margin = scene.add.graphics().setDepth(MARGIN_DEPTH);
  margin.lineStyle(2, MARGIN_RED, 0.45);
  margin.lineBetween(26, 0, 26, LOGICAL_HEIGHT);
  margin.lineStyle(1, MARGIN_RED, 0.3);
  margin.lineBetween(31, 0, 31, LOGICAL_HEIGHT);
}

// Kenney Scribble Platformer scenery (public/assets/kenney/scenery, CC0).
// `padBottom` is each image's transparent rows below the drawing, so
// things stand exactly on the ground line.
type SceneryArt = { key: string; file: string; padBottom: number };

const art = (name: string, padBottom: number): SceneryArt => ({
  key: `kenney-${name}`,
  file: `kenney/scenery/${name}.webp`,
  padBottom,
});

const CLOUDS = [art('cloud-a', 0), art('cloud-b', 1)];
const SKYLINE = {
  castle: art('castle', 1),
  tower: art('tower', 1),
  towerTop: art('tower-top', 1),
  roof: art('roof-round', 1),
  obelisk: art('obelisk', 1),
  archway: art('archway', 1),
  column: art('column', 0),
};
// [art, display height] — trees tower over the pencil, bushes and fences
// sit below his knees.
const NEAR: [SceneryArt, number][] = [
  [art('tree', 2), 190],
  [art('tree-large', 2), 220],
  [art('pine', 3), 96],
  [art('bush', 4), 56],
  [art('bush-half', 1), 58],
  [art('fence', 1), 62],
];

export const KENNEY_SCENERY: SceneryArt[] = [
  ...CLOUDS,
  ...Object.values(SKYLINE),
  ...NEAR.map(([a]) => a),
];

function standOnGround(
  scene: Phaser.Scene,
  a: SceneryArt,
  x: number,
  groundY: number,
  height: number
): Phaser.GameObjects.Image {
  const image = scene.add.image(x, groundY, a.key).setOrigin(0.5, 1);
  image.setScale(height / image.height);
  image.y += a.padBottom * image.scaleY;
  return image;
}

// One far-off building: a castle, a tower with a roof, an obelisk...
function skylinePiece(scene: Phaser.Scene, x: number, rng: Rng, factor: number): void {
  // Far away: everything at about two-thirds size, and pale.
  const place = (a: SceneryArt, px: number, bottom: number, height: number): Phaser.GameObjects.Image =>
    standOnGround(scene, a, x + (px - x) * SKYLINE_SIZE, bottom, height * SKYLINE_SIZE)
      .setScrollFactor(factor, 1)
      .setDepth(SKYLINE_DEPTH)
      .setAlpha(0.22);
  const base = GROUND_TOP_Y + 8;
  const kind = Math.floor(rng() * 5);
  if (kind === 0) {
    place(SKYLINE.castle, x, base, 110);
    place(SKYLINE.castle, x + 100, base, 110);
    const tower = place(SKYLINE.tower, x + 50, base - 100 * SKYLINE_SIZE, 90);
    place(SKYLINE.towerTop, x + 50, tower.y - tower.displayHeight + 4, 70);
  } else if (kind === 1) {
    const tower = place(SKYLINE.tower, x, base, 150);
    place(SKYLINE.roof, x, tower.y - tower.displayHeight + 4, 80);
  } else if (kind === 2) {
    place(SKYLINE.obelisk, x, base, 150);
    place(SKYLINE.column, x + 70, base, 100);
    place(SKYLINE.column, x - 70, base, 80);
  } else if (kind === 3) {
    place(SKYLINE.archway, x, base, 120);
    place(SKYLINE.archway, x + 118, base, 120);
  } else {
    const tower = place(SKYLINE.tower, x, base, 180);
    place(SKYLINE.towerTop, x, tower.y - tower.displayHeight + 4, 80);
    place(SKYLINE.castle, x + 95, base, 90);
  }
}

// Clouds (far), a faint skyline (middle distance) and trees/bushes/fences
// standing on the level's own ground (near). Near pieces only go where
// there's ground under them and keep clear of every hazard, platform,
// power-up and marker, so nothing ever reads as part of the course.
export function drawKenneyScenery(
  scene: Phaser.Scene,
  levelWidth: number,
  objects: LevelObject[],
  seedText: string
): void {
  const rng = seededRng(`${seedText}:scenery`);
  // A parallax layer at scroll factor f only moves f as far as the camera,
  // so it needs levelWidth * f of content plus one screen.
  const span = (factor: number): number => levelWidth * factor + 1400;

  const cloudFactor = 0.25;
  for (let x = range(rng, 60, 260); x < span(cloudFactor); x += range(rng, 280, 520)) {
    const cloud = CLOUDS[Math.floor(rng() * CLOUDS.length)] ?? CLOUDS[0];
    if (!cloud) break;
    const image = scene.add
      .image(x, range(rng, 50, 190), cloud.key)
      .setScrollFactor(cloudFactor, 1)
      .setDepth(CLOUD_DEPTH)
      .setAlpha(0.85);
    image.setScale(range(rng, 130, 220) / image.width);
  }

  const skylineFactor = 0.55;
  for (let x = range(rng, 380, 700); x < span(skylineFactor); x += range(rng, 520, 900)) {
    skylinePiece(scene, x, rng, skylineFactor);
  }

  const half = GRID_CELL_SIZE / 2;
  const groundCells = new Set(
    objects.filter((o) => o.type === 'ground').map((o) => Math.round((o.x - half) / GRID_CELL_SIZE))
  );
  const hasGround = (from: number, to: number): boolean => {
    for (let c = Math.floor(from / GRID_CELL_SIZE); c <= Math.floor(to / GRID_CELL_SIZE); c++) {
      if (!groundCells.has(c)) return false;
    }
    return true;
  };
  const busyX = objects.filter((o) => o.type !== 'ground').map((o) => o.x);
  for (let x = range(rng, 300, 460); x < levelWidth - 60; x += range(rng, 300, 560)) {
    const pick = NEAR[Math.floor(rng() * NEAR.length)] ?? NEAR[0];
    if (!pick) break;
    const [a, height] = pick;
    const halfWidth = height * 0.5;
    if (!hasGround(x - halfWidth, x + halfWidth)) continue;
    if (busyX.some((bx) => Math.abs(bx - x) < halfWidth + 70)) continue;
    standOnGround(scene, a, x, GROUND_TOP_Y + 3, height).setDepth(NEAR_SCENERY_DEPTH);
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
