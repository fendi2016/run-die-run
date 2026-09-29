import * as Phaser from 'phaser';
import { GRID_CELL_SIZE, GROUND_TOP_Y, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../../shared/constants';
import type { LevelObject } from '../../../shared/types';

// Set dressing for a run, so gameplay sits in the same drawn world as the
// title screen instead of on a bare ruled sheet: paper grain, a margin
// rule at the start, crayon scenery from the "background art" sheet
// (clouds, a pale far treeline, trees and bushes) in three parallax layers,
// and grass tufts along the ground.
// Everything here is cosmetic — no bodies, no input — and kept light and
// behind the action so hazards stay visually dominant.

const GRAIN_KEY = 'paper-grain';
const MARGIN_RED = 0xe06666;

// Layering: level-background (-1) < grain < clouds < far treeline < margin <
// pinned paper scraps < near scenery < death markers (-0.5) < spawn pencil case (-0.25) < finish
// gate (-0.1) < ground tiles < ground detail < player and hazards (0).
const GRAIN_DEPTH = -0.95;
const CLOUD_DEPTH = -0.93;
const FAR_TREE_DEPTH = -0.91;
const MARGIN_DEPTH = -0.9;
const PAPER_DECOR_DEPTH = -0.88;
const NEAR_SCENERY_DEPTH = -0.85;
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

// Crayon scenery cut from the user's "background art" sheet
// (public/assets/background). Each piece is trimmed to its drawing, so
// its bottom edge is the ground line.
type SceneryArt = { key: string; file: string };

const art = (name: string): SceneryArt => ({
  key: `bg-${name}`,
  file: `background/${name}.webp`,
});

const CLOUDS = ['cloud-a', 'cloud-b', 'cloud-c', 'cloud-d'].map(art);
const TREES = ['tree-green', 'tree-pink', 'tree-autumn', 'tree-pine', 'tree-palm'].map(art);
const GRASS = ['grass-1', 'grass-2', 'grass-3', 'grass-4', 'grass-5', 'grass-6', 'grass-7', 'grass-8'].map(art);
// [art, display height] — trees tower over the pencil, bushes sit below
// his knees.
const NEAR: [SceneryArt, number][] = [
  ...TREES.map((t): [SceneryArt, number] => [t, 200]),
  [art('tree-small'), 120],
  [art('tree-tiny'), 64],
  [art('bush-a'), 52],
  [art('bush-b'), 56],
  [art('bush-c'), 52],
  [art('bush-d'), 56],
];

// Notebook-paper scraps from the level-piece sheet (public/assets/paper)
// that can't be solid terrain — slopes, wedges, torn strips, holed scraps —
// pinned or clipped to the backdrop instead. `width` is the display width;
// `fastener` is what holds it up (strips that already carry their own tape
// get nothing extra), stuck in at `anchor` — a spot on the paper itself as
// a fraction of the image, since slopes and wedges leave much of their
// bounding box empty.
type Fastener = 'pin' | 'clip' | 'none';
type DecorArt = { key: string; file: string; width: number; fastener: Fastener; anchor: Point };

const decor = (name: string, width: number, fastener: Fastener, ax = 0.5, ay = 0.2): DecorArt => ({
  key: `paper-decor-${name}`,
  file: `paper/${name}.webp`,
  width,
  fastener,
  anchor: { x: ax, y: ay },
});

const PAPER_SCRAPS: DecorArt[] = [
  decor('paper-slope', 150, 'pin', 0.8, 0.3),
  decor('paper-ramp', 130, 'pin', 0.82, 0.35),
  decor('graph-triangle', 90, 'pin', 0.8, 0.4),
  decor('scrap-ramp-holes', 160, 'clip', 0.14, 0.1),
  decor('scrap-wedge-holes', 150, 'pin', 0.72, 0.3),
  decor('paper-wedge-tape', 110, 'none'),
  decor('scrap-ring', 80, 'pin', 0.5, 0.18),
  decor('scrap-hook', 72, 'pin', 0.3, 0.2),
  decor('scrap-holes', 130, 'clip', 0.18, 0.08),
  decor('paper-pillar-small', 56, 'pin', 0.5, 0.16),
  decor('red-corner', 92, 'pin', 0.78, 0.12),
  decor('red-scribble-strip', 120, 'clip', 0.14, 0.14),
  decor('tape-strip', 100, 'none'),
  decor('tape-strip-long', 150, 'none'),
  decor('tape-strip-small', 100, 'none'),
  decor('paper-strip-bluetape', 124, 'none'),
];
const PINS = [decor('pin-red', 30, 'none'), decor('pin-blue', 27, 'none')];
const CLIPS = [decor('paperclip-long', 80, 'none'), decor('paperclip-short', 52, 'none')];

type LoadableArt = { key: string; file: string };

export const SCENERY_ART: LoadableArt[] = [
  ...CLOUDS,
  ...NEAR.map(([a]) => a),
  ...GRASS,
  ...PAPER_SCRAPS,
  ...PINS,
  ...CLIPS,
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
  return image;
}

// A far-off clump of one to three trees: small, pale, and slower than the
// camera, so the page reads as having some distance to it.
function farTrees(scene: Phaser.Scene, x: number, rng: Rng, factor: number): void {
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const tree = TREES[Math.floor(rng() * TREES.length)] ?? TREES[0];
    if (!tree) return;
    standOnGround(scene, tree, x + i * range(rng, 55, 80), GROUND_TOP_Y + 8, range(rng, 90, 130))
      .setScrollFactor(factor, 1)
      .setDepth(FAR_TREE_DEPTH)
      .setAlpha(0.22);
  }
}

// Clouds (far), a faint treeline (middle distance) and trees/bushes
// standing on the level's own ground (near). Near pieces only go where
// there's ground under them and keep clear of every hazard, platform,
// power-up and marker, so nothing ever reads as part of the course.
export function drawScenery(
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

  const farFactor = 0.55;
  for (let x = range(rng, 380, 700); x < span(farFactor); x += range(rng, 520, 900)) {
    farTrees(scene, x, rng, farFactor);
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
  drawPaperDecor(scene, levelWidth, objects, seedText);
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

// Faded paper scraps pinned or clipped to the page between the skyline
// and the near scenery. Pale, warm-grey and tilted so they read as stuff
// stuck to the notebook, never as a ledge to land on. Every scrap in the
// sheet is dealt once (in a seeded shuffle) before any repeats, so even a
// short level shows a good spread.
function drawPaperDecor(
  scene: Phaser.Scene,
  levelWidth: number,
  objects: LevelObject[],
  seedText: string
): void {
  const rng = seededRng(`${seedText}:paper-decor`);
  const factor = 0.72;
  const alpha = 0.34;
  const tint = 0xc8c2b4;
  const halfScreen = LOGICAL_WIDTH / 2;
  // With parallax, a scrap at layer-x `x` passes behind world-x
  // halfScreen + (x - halfScreen) / factor while it's mid-screen, which is
  // where the player's eye is. Keep that spot clear of the course, like the
  // near scenery does, and keep off rows that hold something.
  const busy = objects.filter((o) => o.type !== 'ground');
  const overlapsCourse = (x: number, top: number, bottom: number, halfWidth: number): boolean => {
    const worldX = halfScreen + (x - halfScreen) / factor;
    const reach = halfWidth / factor + GRID_CELL_SIZE;
    return busy.some(
      (o) => Math.abs(o.x - worldX) < reach && o.y + GRID_CELL_SIZE > top && o.y - GRID_CELL_SIZE < bottom
    );
  };

  const deck: DecorArt[] = [];
  const deal = (): DecorArt | undefined => {
    if (deck.length === 0) {
      deck.push(...PAPER_SCRAPS);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const a = deck[i];
        const b = deck[j];
        if (a && b) {
          deck[i] = b;
          deck[j] = a;
        }
      }
    }
    return deck[deck.length - 1];
  };

  const end = levelWidth * factor + LOGICAL_WIDTH;
  for (let x = range(rng, 200, 380); x < end; x += range(rng, 260, 420)) {
    const piece = deal();
    if (!piece) break;
    const y = range(rng, 70, 250);
    const scale = piece.width / scene.textures.getFrame(piece.key).width;
    const halfHeight = (scene.textures.getFrame(piece.key).height * scale) / 2;
    // A crowded stretch: try this slot a little higher before giving up.
    const clearY = [y, 70].find((cy) => !overlapsCourse(x, cy - halfHeight, cy + halfHeight, piece.width / 2));
    if (clearY === undefined) continue;
    deck.pop();

    const angle = range(rng, -9, 9);
    const image = scene.add
      .image(x, clearY, piece.key)
      .setScale(scale)
      .setAngle(angle)
      .setScrollFactor(factor, 1)
      .setDepth(PAPER_DECOR_DEPTH)
      .setAlpha(alpha)
      .setTint(tint);

    if (piece.fastener === 'none') continue;
    const pool = piece.fastener === 'pin' ? PINS : CLIPS;
    const fastener = pool[Math.floor(rng() * pool.length)] ?? pool[0];
    if (!fastener) continue;
    const offsetX = (piece.anchor.x - 0.5) * image.displayWidth;
    const offsetY = (piece.anchor.y - 0.5) * image.displayHeight;
    const rad = Phaser.Math.DegToRad(angle);
    const fx = x + offsetX * Math.cos(rad) - offsetY * Math.sin(rad);
    const fy = clearY + offsetX * Math.sin(rad) + offsetY * Math.cos(rad);
    const holder = scene.add
      .image(fx, fy, fastener.key)
      .setOrigin(0.5, piece.fastener === 'pin' ? 0.85 : 0.5)
      .setAngle(piece.fastener === 'pin' ? range(rng, -12, 12) : angle + range(rng, -20, -8))
      .setScrollFactor(factor, 1)
      .setDepth(PAPER_DECOR_DEPTH + 0.001)
      .setAlpha(alpha + 0.1)
      .setTint(tint);
    holder.setScale(fastener.width / holder.width);
  }
}

// Crayon grass tufts from the background sheet, poking up over the lip of
// about two in five ground tiles. Drawn per tile from the level's own
// ground objects, so gaps stay clean gaps.
const GRASS_HEIGHT = 20;

export function drawGroundDetail(scene: Phaser.Scene, objects: LevelObject[], seedText: string): void {
  const rng = seededRng(`${seedText}:ground`);
  const half = GRID_CELL_SIZE / 2;
  for (const tile of objects.filter((o) => o.type === 'ground')) {
    if (rng() >= 0.4) continue;
    const tuft = GRASS[Math.floor(rng() * GRASS.length)] ?? GRASS[0];
    if (!tuft) return;
    standOnGround(scene, tuft, tile.x - half + range(rng, 16, GRID_CELL_SIZE - 16), tile.y + 3, GRASS_HEIGHT)
      .setDepth(GROUND_DETAIL_DEPTH)
      .setFlipX(rng() < 0.5);
  }
}
