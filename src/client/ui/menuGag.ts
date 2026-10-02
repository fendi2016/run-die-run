import { requireElement } from './domUtils';

// The menu's death gag (#menu-gag, shared by the feed card and game.html's
// menu): the pencil runs in, hits the saw, KABOOM + blood, respawns with a
// poof, and does it again. Timings mirror the game's own death (Juice.ts
// kaboom pop/hold/fade, 20fps pixel sheets, 600ms respawn).
const RUN_SPEED_PX_PER_S = 230;
// On wide screens the run speeds up rather than dragging on.
const MAX_RUN_MS = 1700;
const SAW_AT = 0.45; // fraction of the strip's width
const SPAWN_AT = 0.06;
const RESPAWN_MS = 600;
const BEAT_AFTER_DEATH_MS = 900;
const KABOOM_POP_MS = 90;
const KABOOM_HOLD_MS = 220;
const KABOOM_FADE_MS = 160;
const BLOOD_FRAMES = 10;
const POOF_FRAMES = 7;
const SHEET_FPS = 20;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let started = false;

export function startMenuGag(): void {
  if (started) return;
  started = true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    placeStatic();
    return;
  }
  void loop();
}

function el(id: string): HTMLElement {
  return requireElement(id);
}

function placeAt(sprite: HTMLElement, centerX: number): void {
  sprite.style.transform = `translateX(${centerX - sprite.offsetWidth / 2}px)`;
}

// Reduced motion: the pencil just stands a little short of the saw.
function placeStatic(): void {
  const width = el('menu-gag').clientWidth;
  placeAt(el('menu-gag-saw'), width * SAW_AT);
  placeAt(el('menu-gag-runner'), width * (SAW_AT - 0.2));
}

// Plays a one-row pixel sheet once on `sprite`, centred at x.
async function playSheet(sprite: HTMLElement, x: number, frames: number): Promise<void> {
  placeAt(sprite, x);
  const size = sprite.offsetHeight;
  sprite.style.opacity = '1';
  await sprite.animate(
    [{ backgroundPosition: '0 0' }, { backgroundPosition: `${-size * frames}px 0` }],
    { duration: (frames / SHEET_FPS) * 1000, easing: `steps(${frames})` }
  ).finished;
  sprite.style.opacity = '0';
}

async function kaboom(x: number): Promise<void> {
  const sprite = el('menu-gag-kaboom');
  const left = x - sprite.offsetWidth / 2;
  const tilt = Math.round(Math.random() * 16 - 8);
  const at = (scale: number, opacity: number): Keyframe => ({
    transform: `translateX(${left}px) rotate(${tilt}deg) scale(${scale})`,
    opacity,
  });
  const total = KABOOM_POP_MS + KABOOM_HOLD_MS + KABOOM_FADE_MS;
  await sprite.animate(
    [
      { ...at(0.6, 0), offset: 0, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      { ...at(1, 1), offset: KABOOM_POP_MS / total },
      { ...at(1, 1), offset: (KABOOM_POP_MS + KABOOM_HOLD_MS) / total, easing: 'ease-in' },
      { ...at(1.1, 0), offset: 1 },
    ],
    { duration: total }
  ).finished;
}

function shake(target: HTMLElement): void {
  target.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: 'translate(-3px, 2px)' },
      { transform: 'translate(3px, -2px)' },
      { transform: 'translate(-2px, 1px)' },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 160 }
  );
}

// Only runs while the gag is on screen: the expanded game hides the menu
// for whole runs, and a backgrounded tab shouldn't keep animating.
function isVisible(gag: HTMLElement): boolean {
  return !document.hidden && gag.offsetParent !== null && gag.clientWidth > 0;
}

async function loop(): Promise<void> {
  const gag = el('menu-gag');
  const runner = el('menu-gag-runner');
  let first = true;
  for (;;) {
    if (!isVisible(gag)) {
      first = true;
      await sleep(500);
      continue;
    }
    const width = gag.clientWidth;
    const sawX = width * SAW_AT;
    placeAt(el('menu-gag-saw'), sawX);
    const spawnX = first ? -runner.offsetWidth : width * SPAWN_AT;
    // He dies when his front foot reaches the saw's teeth.
    const hitX = sawX - el('menu-gag-saw').offsetWidth * 0.55;

    runner.style.visibility = 'visible';
    if (!first) void playSheet(el('menu-gag-poof'), spawnX, POOF_FRAMES);
    first = false;
    const half = runner.offsetWidth / 2;
    await runner.animate(
      [
        { transform: `translateX(${spawnX - half}px)` },
        { transform: `translateX(${hitX - half}px)` },
      ],
      {
        duration: Math.min(((hitX - spawnX) / RUN_SPEED_PX_PER_S) * 1000, MAX_RUN_MS),
        fill: 'forwards',
      }
    ).finished;

    runner.style.visibility = 'hidden';
    shake(gag);
    void playSheet(el('menu-gag-blood'), hitX, BLOOD_FRAMES);
    await kaboom(hitX);
    await sleep(RESPAWN_MS + BEAT_AFTER_DEATH_MS - (KABOOM_POP_MS + KABOOM_HOLD_MS + KABOOM_FADE_MS));
  }
}
