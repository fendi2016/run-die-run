import { requireElement } from './domUtils';

// The menu's death gag (#menu-gag inside the Play button, shared by the feed
// card and game.html's menu): the pencil runs along Play's top edge, hits
// the saw at its far end, KABOOM + blood, respawns with a poof, again.
// Timings mirror the game's own death (Juice.ts kaboom pop/hold/fade, 20fps
// pixel sheets, 600ms respawn).
const RUN_FRAMES = 19;
// One stride covers this many runner-heights, same ratio as in the game
// (620px/s over a 228ms cycle for a ~69px-tall drawn pencil), so the run
// frame comes from distance covered and the feet stay planted.
const STRIDE_PER_HEIGHT = 2.05;
// Slower than the game's ~9 heights/s so the joke is readable.
const RUN_HEIGHTS_PER_S = 4.2;
const SAW_AT = 0.86; // fraction of Play's width
const RESPAWN_MS = 600;
const BEAT_AFTER_DEATH_MS = 700;
const KABOOM_POP_MS = 90;
const KABOOM_HOLD_MS = 220;
const KABOOM_FADE_MS = 160;
const KABOOM_MS = KABOOM_POP_MS + KABOOM_HOLD_MS + KABOOM_FADE_MS;
const BLOOD_FRAMES = 10;
const POOF_FRAMES = 7;
const SHEET_FPS = 20;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

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

function showRunFrame(runner: HTMLElement, frame: number): void {
  runner.style.backgroundPosition = `${-frame * runner.offsetWidth}px 0`;
}

// Reduced motion: the pencil just stands on Play, short of the saw.
function placeStatic(): void {
  const width = el('menu-gag').clientWidth;
  const runner = el('menu-gag-runner');
  placeAt(el('menu-gag-saw'), width * SAW_AT);
  placeAt(runner, width * 0.3);
  showRunFrame(runner, 0);
  runner.style.visibility = 'visible';
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
  await sprite.animate(
    [
      { ...at(0.6, 0), offset: 0, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      { ...at(1, 1), offset: KABOOM_POP_MS / KABOOM_MS },
      { ...at(1, 1), offset: (KABOOM_POP_MS + KABOOM_HOLD_MS) / KABOOM_MS, easing: 'ease-in' },
      { ...at(1.1, 0), offset: 1 },
    ],
    { duration: KABOOM_MS }
  ).finished;
}

// Runs from spawnX to hitX (centre x), picking each frame's pose from the
// distance covered so far.
async function run(runner: HTMLElement, spawnX: number, hitX: number): Promise<void> {
  const height = runner.offsetHeight;
  const speed = height * RUN_HEIGHTS_PER_S;
  const stride = height * STRIDE_PER_HEIGHT;
  const start = await nextFrame();
  for (let now = start; ; now = await nextFrame()) {
    const travelled = Math.min(((now - start) / 1000) * speed, hitX - spawnX);
    placeAt(runner, spawnX + travelled);
    showRunFrame(runner, Math.floor((travelled / stride) * RUN_FRAMES) % RUN_FRAMES);
    runner.style.visibility = 'visible';
    if (spawnX + travelled >= hitX) return;
  }
}

// Only runs while the gag is on screen: the expanded game hides the menu
// for whole runs, and a backgrounded tab shouldn't keep animating.
function isVisible(gag: HTMLElement): boolean {
  return !document.hidden && gag.offsetParent !== null && gag.clientWidth > 0;
}

async function loop(): Promise<void> {
  const gag = el('menu-gag');
  const runner = el('menu-gag-runner');
  const saw = el('menu-gag-saw');
  for (;;) {
    if (!isVisible(gag)) {
      await sleep(500);
      continue;
    }
    const width = gag.clientWidth;
    const sawX = width * SAW_AT;
    placeAt(saw, sawX);
    // Spawns on Play's left end; dies when his front foot reaches the teeth.
    const spawnX = runner.offsetWidth * 0.35;
    const hitX = sawX - saw.offsetWidth * 0.5 - runner.offsetWidth * 0.3;

    void playSheet(el('menu-gag-poof'), spawnX, POOF_FRAMES);
    await run(runner, spawnX, hitX);

    runner.style.visibility = 'hidden';
    void playSheet(el('menu-gag-blood'), hitX + runner.offsetWidth * 0.2, BLOOD_FRAMES);
    await kaboom(sawX);
    await sleep(RESPAWN_MS + BEAT_AFTER_DEATH_MS - KABOOM_MS);
  }
}
