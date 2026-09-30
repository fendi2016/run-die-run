import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT } from '../../../shared/constants';

// Set dressing for a run: one backdrop, the same on every level — ruled
// notebook paper (with grain and a margin rule where the page begins) and
// a fixed set of crayon clouds from the "background art" sheet.
// Everything here is cosmetic — no bodies, no input — and kept light and
// behind the action so hazards stay visually dominant.

const GRAIN_KEY = 'paper-grain';
const MARGIN_RED = 0xe06666;

// Layering: level-background (-1) < grain < clouds < margin <
// death markers (-0.5) < spawn pencil case (-0.25) < finish
// gate (-0.1) < ground tiles < player and hazards (0).
const GRAIN_DEPTH = -0.95;
const CLOUD_DEPTH = -0.93;
const MARGIN_DEPTH = -0.9;
export const GROUND_TILE_DEPTH = -0.08;

type Rng = () => number;

// Deterministic, so the paper grain is the same on every page.
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

// Crayon clouds cut from the user's "background art" sheet
// (public/assets/background), pinned to the camera in one fixed
// arrangement so every level shows the same sky: [file, x, y, width] with
// x/y as fractions of the screen.
const CLOUDS: [string, number, number, number][] = [
  ['cloud-a', 0.14, 0.13, 190],
  ['cloud-d', 0.42, 0.24, 130],
  ['cloud-b', 0.68, 0.11, 200],
  ['cloud-c', 0.9, 0.28, 150],
];

const cloudKey = (name: string): string => `bg-${name}`;

export const SCENERY_ART: { key: string; file: string }[] = CLOUDS.map(([name]) => ({
  key: cloudKey(name),
  file: `background/${name}.webp`,
}));

// Pinned clouds still go through the camera's zoom, which pivots on the
// view's centre — so a cloud placed at raw screen-fraction coordinates
// gets pushed off the edges once zoom != 1. Place them by inverting that
// pivot instead, and re-run it (the returned function) whenever the zoom
// or the screen size changes.
export function drawScenery(scene: Phaser.Scene): () => void {
  const clouds = CLOUDS.map(([name, fx, fy, width]) => ({
    fx,
    fy,
    width,
    image: scene.add.image(0, 0, cloudKey(name)).setScrollFactor(0).setDepth(CLOUD_DEPTH).setAlpha(0.85),
  }));
  const layout = (): void => {
    const camera = scene.cameras.main;
    const { width: viewW, height: viewH, zoom } = camera;
    // Same on-screen size as on a 960x540 view, scaled with the screen.
    const screenScale = viewH / LOGICAL_HEIGHT;
    for (const { fx, fy, width, image } of clouds) {
      image.setPosition((fx * viewW - viewW / 2) / zoom + viewW / 2, (fy * viewH - viewH / 2) / zoom + viewH / 2);
      image.setScale((width * screenScale) / zoom / image.width);
    }
  };
  layout();
  return layout;
}
