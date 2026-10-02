import { requireElement } from './domUtils';

// The menu's death gag (#menu-gag inside the Play button, shared by the feed
// card and game.html's menu): the pencil runs along Play's top edge into
// the saw at its far end, is sliced in half exactly like the game's saw
// death (DeathEffects.ts sawSlice), respawns with a poof, again.
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
// sawSlice's distances are for the game's pencil, whose drawn art is about
// this tall; scaled to the runner's height here.
const GAME_ART_H = 69;
const SLICE_MS = 520;
const SPARK_COLOR = '#ffd23f';
const GORE_COLOR = '#e0303a';
const BLOOD_FRAMES = 10;
const SPRAY_FRAMES = 7;
const SPRAY_ORIGIN = 0.82;
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

// Plays a one-row pixel sheet once on `sprite`, its `anchor` fraction of
// width at x (centred by default).
async function playSheet(
  sprite: HTMLElement,
  x: number,
  frames: number,
  anchor = 0.5
): Promise<void> {
  sprite.style.transform = `translateX(${x - sprite.offsetWidth * anchor}px)`;
  const size = sprite.offsetHeight;
  sprite.style.opacity = '1';
  await sprite.animate(
    [{ backgroundPosition: '0 0' }, { backgroundPosition: `${-size * frames}px 0` }],
    { duration: (frames / SHEET_FPS) * 1000, easing: `steps(${frames})` }
  ).finished;
  sprite.style.opacity = '0';
}

// Sparks or gore flying out from (x, y above the gag's bottom), like the
// game's burstParticles (80-260px/s, 420ms, shrinking).
function burst(gag: HTMLElement, x: number, y: number, color: string, count: number, k: number): void {
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('span');
    bit.className = 'menu-gag-bit';
    bit.style.background = color;
    gag.append(bit);
    const angle = Math.random() * Math.PI * 2;
    const reach = (80 + Math.random() * 180) * 0.42 * k;
    const from = `translate(${x - 2}px, ${-y + 2}px)`;
    const to = `translate(${x - 2 + Math.cos(angle) * reach}px, ${-y + 2 + Math.sin(angle) * reach}px)`;
    bit
      .animate([{ transform: `${from} scale(1)` }, { transform: `${to} scale(0)` }], {
        duration: 420,
        easing: 'ease-out',
      })
      .finished.finally(() => bit.remove())
      .catch(() => undefined);
  }
}

// sawSlice: the pose cut at the waist — the top half flung up and back,
// spinning, the legs stagger a beat and topple — with sparks and blood
// where the blade went through.
async function slice(gag: HTMLElement, runner: HTMLElement, x: number): Promise<void> {
  const height = runner.offsetHeight;
  const k = height / GAME_ART_H;
  const left = x - runner.offsetWidth / 2;
  const pose = runner.style.backgroundPosition;
  const top = el('menu-gag-top');
  const legs = el('menu-gag-legs');
  for (const half of [top, legs]) {
    half.style.backgroundPosition = pose;
    half.style.visibility = 'visible';
  }
  runner.style.visibility = 'hidden';
  const at = (dx: number, dy: number, deg: number): string =>
    `translate(${left + dx * k}px, ${dy * k}px) rotate(${deg}deg)`;
  const flung = top.animate(
    [
      { transform: at(0, 0, 0), opacity: 1, easing: 'cubic-bezier(0.5, 1, 0.89, 1)' },
      { transform: at(-27, -70, -115), opacity: 1, offset: 200 / SLICE_MS, easing: 'cubic-bezier(0.11, 0, 0.5, 0)' },
      { transform: at(-70, 90, -300), opacity: 0 },
    ],
    { duration: SLICE_MS }
  );
  const toppled = legs.animate(
    [
      { transform: at(0, 0, 0), opacity: 1 },
      { transform: at(4, 0, 0), opacity: 1, offset: 0.1 },
      { transform: at(0, 0, 0), opacity: 1, offset: 0.2 },
      { transform: at(4, 0, 0), opacity: 1, offset: 0.3 },
      { transform: at(0, 0, 0), opacity: 1, offset: 0.4, easing: 'ease-in' },
      { transform: at(14, 8, 80), opacity: 1, offset: 0.75 },
      { transform: at(14, 8, 80), opacity: 0 },
    ],
    { duration: 600 }
  );
  const cutY = height / 2;
  burst(gag, x, cutY, SPARK_COLOR, 18, k);
  burst(gag, x, cutY, GORE_COLOR, 22, k);
  void playSheet(el('menu-gag-blood'), x, BLOOD_FRAMES);
  void playSheet(el('menu-gag-spray'), x, SPRAY_FRAMES, SPRAY_ORIGIN);
  gag.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: 'translate(-2px, 1px)' },
      { transform: 'translate(2px, -1px)' },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 140 }
  );
  await Promise.all([flung.finished, toppled.finished]);
  top.style.visibility = 'hidden';
  legs.style.visibility = 'hidden';
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

    await slice(gag, runner, hitX);
    await sleep(RESPAWN_MS + BEAT_AFTER_DEATH_MS - 600);
  }
}
