import { requireElement } from './domUtils';

// The menu's death gag, drawn on one canvas (#menu-gag) over the whole menu
// (shared by the feed card and game.html's menu): the pencil runs along
// Play's top edge into the saw and gets sharpened to nothing — the drawn
// destruction sequence (ui/menu-gag-shaved.webp) plays while real shaving
// sprites (ui/menu-gag-shavings.webp) fly off the blade and pile up on
// Play, down to a heap with his eraser and shoes. Then it fades and he
// respawns with a poof. One rAF loop and plain drawImage/arc calls,
// no DOM churn, so it stays smooth on phones.

// Run strip: 19 frames of 114x128, one stride (ui/menu-gag-run.webp).
const RUN_FRAMES = 19;
const FRAME_W = 114;
const FRAME_H = 128;
// Drawn wider than the art, like the game (PLAYER_DISPLAY_WIDTH_SCALE).
const WIDTH_SCALE = 1.25;
// Same stride-to-height ratio as the game, so the pose follows distance
// covered and the feet stay planted.
const STRIDE_PER_HEIGHT = 2.05;
const RUN_HEIGHTS_PER_S = 4.2;
const SAW_AT = 0.86; // fraction of Play's width
const SAW_RADIUS = 0.4; // of the runner's height
// Counter-clockwise (negative is anticlockwise on a y-down canvas). The 14
// teeth are ~26 degrees apart, so a turn faster than ~13 degrees a frame
// strobes and reads as spinning the wrong way: 1s a turn idle, and grinding
// as fast as 60fps allows.
const SAW_SPIN = (-Math.PI * 2) / 1.0;
const SAW_SPIN_GRINDING = (-Math.PI * 2) / 0.6;

// Destruction strip: 8 frames of 65x128, the pencil standing in each
// with its eraser-to-shoe height at 365/375 of the cell.
const SHAVED_FRAMES = 8;
const SHAVED_W = 65;
const SHAVED_H = 128;
const SHAVED_ART = 365 / 375;
const SHAVED_FRAME_MS = [220, 160, 170, 170, 170, 190, 210, 0];
const PILE_MS = 1100;
const FADE_MS = 400;
const POOF_MS = 350;
const POOF_FRAMES = 7;
// Shavings strip: 24 pieces of 48x48.
const SHAVING_SPRITES = 24;
const SHAVING_PX = 48;
const MAX_SHAVINGS = 120;

type Shaving = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  sprite: number;
  stuck: boolean;
};

type Layout = {
  dpr: number;
  width: number;
  height: number;
  playLeft: number;
  playTop: number;
  playWidth: number;
  runnerH: number;
};

type Phase = 'run' | 'shave' | 'pile' | 'fade';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`menu gag: ${src} failed to load`));
    image.src = src;
  });
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

let started = false;

export function startMenuGag(): void {
  if (started) return;
  started = true;
  void Promise.all([
    loadImage('/assets/ui/menu-gag-run.webp'),
    loadImage('/assets/hazards/saw-spin.webp'),
    loadImage('/assets/vfx/smoke-poof.webp'),
    loadImage('/assets/ui/menu-gag-shaved.webp'),
    loadImage('/assets/ui/menu-gag-shavings.webp'),
  ])
    .then(([run, saw, poof, shaved, shavings]) =>
      new MenuGag(run, saw, poof, shaved, shavings).start()
    )
    .catch(() => undefined); // No gag; the menu works without it.
}

class MenuGag {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly root: HTMLElement;
  private readonly play: HTMLElement;
  private readonly cta: HTMLElement;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private phase: Phase = 'run';
  private phaseStart = 0;
  private lastTime = 0;
  private sawAngle = 0;
  private frame = 0;
  // Where he stopped against the saw.
  private hitX = 0;
  private shavings: Shaving[] = [];

  constructor(
    private readonly runImage: HTMLImageElement,
    private readonly sawImage: HTMLImageElement,
    private readonly poofImage: HTMLImageElement,
    private readonly shavedImage: HTMLImageElement,
    private readonly shavingsImage: HTMLImageElement
  ) {
    const canvas = requireElement('menu-gag');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#menu-gag must be a canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('menu gag: no 2d context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.root = requireElement('game-menu');
    this.play = requireElement('game-menu-play');
    this.cta = requireElement('game-menu-cta');
  }

  start(): void {
    const tick = (now: number): void => {
      // Paused while the menu is hidden (the expanded game hides it for
      // whole runs) or the tab is in the background.
      if (document.hidden || this.root.offsetParent === null) {
        this.lastTime = 0;
        window.setTimeout(() => requestAnimationFrame(tick), 500);
        return;
      }
      this.draw(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private layout(): Layout {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rootRect = this.root.getBoundingClientRect();
    const playRect = this.play.getBoundingClientRect();
    const runnerH = parseFloat(getComputedStyle(this.cta).getPropertyValue('--runner-h')) || 56;
    return {
      dpr,
      width: rootRect.width,
      height: rootRect.height,
      playLeft: playRect.left - rootRect.left,
      playTop: playRect.top - rootRect.top,
      playWidth: playRect.width,
      runnerH,
    };
  }

  private enter(phase: Phase, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  private draw(now: number): void {
    const l = this.layout();
    const pxW = Math.round(l.width * l.dpr);
    const pxH = Math.round(l.height * l.dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    const ctx = this.ctx;
    ctx.setTransform(l.dpr, 0, 0, l.dpr, 0, 0);
    ctx.clearRect(0, 0, l.width, l.height);

    const dt = this.lastTime === 0 ? 0 : Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (this.phaseStart === 0) this.phaseStart = now;
    const t = now - this.phaseStart;

    const h = l.runnerH;
    const w = h * (FRAME_W / FRAME_H) * WIDTH_SCALE;
    const sawR = h * SAW_RADIUS;
    const feetY = l.playTop + 1;
    const spawnX = l.playLeft + w * 0.35;
    const sawX = l.playLeft + l.playWidth * SAW_AT;
    // Mostly out of Play, so it's a big blade to run into.
    const sawY = feetY - sawR * 0.15;

    if (this.reducedMotion) {
      this.drawSaw(l, sawX, sawY, sawR, 0);
      this.drawWhole(l.playLeft + l.playWidth * 0.3, feetY, w, h, 0);
      return;
    }

    this.sawAngle += dt * (this.phase === 'shave' ? SAW_SPIN_GRINDING : SAW_SPIN);
    this.updateShavings(l, dt, h);
    this.drawShavings(this.phase === 'fade' ? 1 - clamp01(t / FADE_MS) : 1);

    switch (this.phase) {
      case 'run': {
        const hitX = sawX - sawR - w * 0.25;
        const speed = h * RUN_HEIGHTS_PER_S;
        const x = Math.min(spawnX + (t / 1000) * speed, hitX);
        this.frame =
          Math.floor(((x - spawnX) / (h * STRIDE_PER_HEIGHT)) * RUN_FRAMES) % RUN_FRAMES;
        if (t < POOF_MS) this.drawPoof(spawnX, feetY, h, t);
        this.drawWhole(x, feetY, w, h, this.frame);
        if (x >= hitX) {
          this.hitX = hitX;
          this.enter('shave', now);
        }
        break;
      }
      case 'shave': {
        // The drawn sequence: shocked, wincing, then swallowed by shavings
        // down to a heap — with real shavings flying off the blade.
        let frame = 0;
        let elapsed = t;
        while (frame < SHAVED_FRAMES - 1 && elapsed >= (SHAVED_FRAME_MS[frame] ?? 0)) {
          elapsed -= SHAVED_FRAME_MS[frame] ?? 0;
          frame += 1;
        }
        const jitter = frame > 0 && frame < SHAVED_FRAMES - 1 ? Math.sin(now / 5) * 1.4 : 0;
        this.drawShaved(this.hitX + jitter, feetY, h, frame);
        if (frame >= 1 && frame <= 6) {
          this.emitShavings(sawX - sawR * 0.7, feetY - h * 0.45, h, dt, 34);
        }
        if (frame === SHAVED_FRAMES - 1) this.enter('pile', now);
        break;
      }
      case 'pile':
      case 'fade': {
        const alpha = this.phase === 'fade' ? 1 - clamp01(t / FADE_MS) : 1;
        ctx.globalAlpha = alpha;
        this.drawShaved(this.hitX, feetY, h, SHAVED_FRAMES - 1);
        ctx.globalAlpha = 1;
        if (this.phase === 'pile' && t >= PILE_MS) this.enter('fade', now);
        if (this.phase === 'fade' && t >= FADE_MS) {
          this.shavings = [];
          this.enter('run', now);
        }
        break;
      }
    }

    this.drawSaw(l, sawX, sawY, sawR, this.sawAngle);
  }

  // One run-strip frame, bottom-centre at (x, feetY).
  private drawWhole(x: number, feetY: number, w: number, h: number, frame: number): void {
    this.ctx.drawImage(this.runImage, frame * FRAME_W, 0, FRAME_W, FRAME_H, x - w / 2, feetY - h, w, h);
  }

  // One destruction frame, the pencil's feet at feetY, as tall as the runner.
  private drawShaved(x: number, feetY: number, h: number, frame: number): void {
    const dh = h / SHAVED_ART;
    const dw = dh * (SHAVED_W / SHAVED_H);
    this.ctx.drawImage(
      this.shavedImage,
      frame * SHAVED_W,
      0,
      SHAVED_W,
      SHAVED_H,
      x - dw / 2,
      feetY - dh,
      dw,
      dh
    );
  }

  // Sunk into Play: never drawn below its top edge.
  private drawSaw(l: Layout, x: number, y: number, r: number, angle: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, l.width, l.playTop + 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(this.sawImage, -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  private drawPoof(x: number, feetY: number, h: number, t: number): void {
    const frame = Math.min(POOF_FRAMES - 1, Math.floor((t / POOF_MS) * POOF_FRAMES));
    const size = h * 1.2;
    const src = this.poofImage.height;
    this.ctx.drawImage(this.poofImage, frame * src, 0, src, src, x - size / 2, feetY - size * 0.85, size, size);
  }

  // Shavings thrown off the blade, mostly up and out to both sides.
  private emitShavings(x: number, y: number, h: number, dt: number, perSecond: number): void {
    const k = h / 56;
    let count = perSecond * dt;
    while (count > 0 && this.shavings.length < MAX_SHAVINGS) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      // Off the front of the blade: up and back over him, some forward.
      const angle = -Math.PI / 2 + (Math.random() - 0.65) * Math.PI * 1.3;
      const speed = (200 + Math.random() * 320) * k;
      this.shavings.push({
        x: x + (Math.random() - 0.5) * 6,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (12 + Math.random() * 10) * k,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 12,
        sprite: Math.floor(Math.random() * SHAVING_SPRITES),
        stuck: false,
      });
    }
  }

  // Light, fluttery fall; the ones that land on Play pile up there.
  private updateShavings(l: Layout, dt: number, h: number): void {
    const gravity = 900 * (h / 56);
    const playRight = l.playLeft + l.playWidth;
    this.shavings = this.shavings.filter((s) => {
      if (s.stuck) return true;
      const prevY = s.y;
      s.vy += gravity * dt;
      s.vx *= 1 - 1.2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
      if (s.vy > 0 && prevY <= l.playTop && s.y >= l.playTop && s.x > l.playLeft && s.x < playRight) {
        s.y = l.playTop - s.size * 0.35;
        s.stuck = true;
        return true;
      }
      return s.y < l.height + 10 && s.x > -10 && s.x < l.width + 10;
    });
  }

  private drawShavings(alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    for (const s of this.shavings) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.drawImage(
        this.shavingsImage,
        s.sprite * SHAVING_PX,
        0,
        SHAVING_PX,
        SHAVING_PX,
        -s.size / 2,
        -s.size / 2,
        s.size,
        s.size
      );
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
