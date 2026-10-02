import { requireElement } from './domUtils';

// The menu's death gag, drawn on one canvas (#menu-gag) over the whole menu
// (shared by the feed card and game.html's menu): the pencil runs along
// Play's top edge into a saw, which hops up over his head and slowly saws
// him down the middle while blood sprays all over the card; the halves
// flop open, everything fades, he respawns with a poof. One rAF loop and
// plain drawImage/arc calls — no DOM churn — so it stays smooth on phones.

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
const SAW_RADIUS = 0.31; // of the runner's height
// Counter-clockwise (negative is anticlockwise on a y-down canvas).
const SAW_SPIN = (-Math.PI * 2) / 0.6;
const SAW_SPIN_CUTTING = (-Math.PI * 2) / 0.25;

const HOP_MS = 260;
const CUT_MS = 1500;
const FALL_MS = 420;
const HOLD_MS = 700;
const FADE_MS = 350;
const POOF_MS = 350;
const POOF_FRAMES = 7;
// How far the halves have peeled open by the time the saw reaches his feet.
const SPLAY_MAX = 0.5;

const BLOOD_COLORS = ['#e0303a', '#b3121f', '#ff4d5a'];
const MAX_DROPS = 700;

type Drop = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
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

type Phase = 'run' | 'hop' | 'cut' | 'fall' | 'hold' | 'fade';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`menu gag: ${src} failed to load`));
    image.src = src;
  });
}

// How far to raise the halves at `angle` so their outer bottom corners stay
// on the floor: none while still splaying, half their width once flat.
function liftFor(angle: number, w: number): number {
  const from = Math.sin(SPLAY_MAX);
  return (w / 2) * clamp01((Math.sin(angle) - from) / (1 - from));
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

let started = false;

export function startMenuGag(): void {
  if (started) return;
  started = true;
  void Promise.all([
    loadImage('/assets/ui/menu-gag-run.webp'),
    loadImage('/assets/hazards/saw-spin.webp'),
    loadImage('/assets/vfx/smoke-poof.webp'),
  ])
    .then(([run, saw, poof]) => new MenuGag(run, saw, poof).start())
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
  // Where he stopped, his pose, and the saw's path for this death.
  private hitX = 0;
  private frame = 0;
  private drops: Drop[] = [];

  constructor(
    private readonly runImage: HTMLImageElement,
    private readonly sawImage: HTMLImageElement,
    private readonly poofImage: HTMLImageElement
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
    const sawRestX = l.playLeft + l.playWidth * SAW_AT;
    const sawRestY = feetY + sawR * 0.25;

    if (this.reducedMotion) {
      this.drawSaw(l, sawRestX, sawRestY, sawR, 0);
      this.drawWhole(l.playLeft + l.playWidth * 0.3, feetY, w, h, 0);
      return;
    }

    this.sawAngle += dt * (this.phase === 'cut' ? SAW_SPIN_CUTTING : SAW_SPIN);
    const hitX = sawRestX - sawR - w * 0.3;
    const sawAboveY = feetY - h - sawR * 0.4;
    let sawX = sawRestX;
    let sawY = sawRestY;
    let fade = 1;

    switch (this.phase) {
      case 'run': {
        const speed = h * RUN_HEIGHTS_PER_S;
        const x = Math.min(spawnX + (t / 1000) * speed, hitX);
        const travelled = x - spawnX;
        this.frame = Math.floor((travelled / (h * STRIDE_PER_HEIGHT)) * RUN_FRAMES) % RUN_FRAMES;
        if (t < POOF_MS) this.drawPoof(spawnX, feetY, h, t);
        this.drawWhole(x, feetY, w, h, this.frame);
        if (x >= hitX) {
          this.hitX = hitX;
          this.enter('hop', now);
        }
        break;
      }
      case 'hop': {
        // The saw jumps out of Play and up over his head.
        const p = easeOut(clamp01(t / HOP_MS));
        sawX = sawRestX + (this.hitX - sawRestX) * p;
        sawY = sawRestY + (sawAboveY - sawRestY) * p - Math.sin(p * Math.PI) * h * 0.25;
        this.drawWhole(this.hitX + Math.sin(now / 9) * 1.2, feetY, w, h, this.frame);
        if (t >= HOP_MS) this.enter('cut', now);
        break;
      }
      case 'cut': {
        // Slowly down through his middle; the halves peel open above it.
        const p = clamp01(t / CUT_MS);
        sawX = this.hitX;
        sawY = sawAboveY + (feetY - sawAboveY) * p;
        const cutY = Math.min(sawY + sawR * 0.6, feetY);
        const shake = Math.sin(now / 7) * 1.6;
        this.drawSplit(this.hitX + shake, feetY, w, h, cutY, SPLAY_MAX * p);
        if (cutY > feetY - h) this.spray(this.hitX, cutY, h, dt, 520);
        if (t >= CUT_MS) this.enter('fall', now);
        break;
      }
      case 'fall': {
        // Both halves flop open flat onto Play.
        const p = clamp01(t / FALL_MS);
        const angle = SPLAY_MAX + (Math.PI / 2 - SPLAY_MAX) * easeIn(p);
        sawY = feetY + sawR * 0.25;
        sawX = this.hitX;
        this.drawSplit(this.hitX, feetY, w, h, feetY, angle, liftFor(angle, w));
        this.spray(this.hitX, feetY - h * 0.1, h, dt, 260 * (1 - p));
        if (t >= FALL_MS) this.enter('hold', now);
        break;
      }
      case 'hold': {
        // The saw grinds back to its spot; the blood keeps trickling.
        const p = easeOut(clamp01(t / 300));
        sawX = this.hitX + (sawRestX - this.hitX) * p;
        this.drawSplit(this.hitX, feetY, w, h, feetY, Math.PI / 2, w / 2);
        this.spray(this.hitX, feetY - h * 0.05, h, dt, 60);
        if (t >= HOLD_MS) this.enter('fade', now);
        break;
      }
      case 'fade': {
        fade = 1 - clamp01(t / FADE_MS);
        ctx.globalAlpha = fade;
        this.drawSplit(this.hitX, feetY, w, h, feetY, Math.PI / 2, w / 2);
        ctx.globalAlpha = 1;
        if (t >= FADE_MS) {
          this.drops = [];
          this.enter('run', now);
        }
        break;
      }
    }

    this.updateDrops(l, dt, h);
    this.drawDrops(fade);
    this.drawSaw(l, sawX, sawY, sawR, this.sawAngle);
  }

  // One run-strip frame, bottom-centre at (x, feetY).
  private drawWhole(x: number, feetY: number, w: number, h: number, frame: number): void {
    this.ctx.drawImage(this.runImage, frame * FRAME_W, 0, FRAME_W, FRAME_H, x - w / 2, feetY - h, w, h);
  }

  // The pose cut down the middle above cutY: each half rotated `angle` away
  // from the other about the bottom of the cut; below it, still whole.
  // `lift` raises the halves so, once fully cut, their outer edges ride on
  // Play's top instead of swinging down into it.
  private drawSplit(
    x: number,
    feetY: number,
    w: number,
    h: number,
    cutY: number,
    angle: number,
    lift = 0
  ): void {
    const ctx = this.ctx;
    const sx = this.frame * FRAME_W;
    const top = feetY - h;
    if (cutY < feetY) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - w, cutY, w * 2, feetY - cutY + 2);
      ctx.clip();
      this.drawWhole(x, feetY, w, h, this.frame);
      ctx.restore();
    }
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(x, cutY - lift);
      ctx.rotate(side * angle);
      ctx.translate(-x, -cutY);
      ctx.beginPath();
      ctx.rect(side < 0 ? x - w : x, top - 2, w, cutY - top + 2);
      ctx.clip();
      ctx.drawImage(
        this.runImage,
        side < 0 ? sx : sx + FRAME_W / 2,
        0,
        FRAME_W / 2,
        FRAME_H,
        side < 0 ? x - w / 2 : x,
        top,
        w / 2,
        h
      );
      ctx.restore();
    }
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

  // Blood out of the cut: mostly up and sideways, fast, all over the card.
  private spray(x: number, y: number, h: number, dt: number, perSecond: number): void {
    const k = h / 56;
    let count = perSecond * dt;
    while (count > 0 && this.drops.length < MAX_DROPS) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = (250 + Math.random() * 650) * k;
      const big = Math.random() < 0.12;
      this.drops.push({
        x: x + (Math.random() - 0.5) * 4,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: (big ? 3.5 + Math.random() * 3 : 1.2 + Math.random() * 2.3) * k,
        color: BLOOD_COLORS[Math.floor(Math.random() * BLOOD_COLORS.length)] ?? '#e0303a',
        stuck: false,
      });
    }
  }

  private updateDrops(l: Layout, dt: number, h: number): void {
    const gravity = 1500 * (h / 56);
    const playRight = l.playLeft + l.playWidth;
    this.drops = this.drops.filter((d) => {
      if (d.stuck) return true;
      const prevY = d.y;
      d.vy += gravity * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // Landing on Play's top edge leaves a splat there.
      if (d.vy > 0 && prevY <= l.playTop && d.y >= l.playTop && d.x > l.playLeft && d.x < playRight) {
        d.y = l.playTop + 1;
        d.stuck = true;
        return true;
      }
      return d.y < l.height + 10 && d.x > -10 && d.x < l.width + 10;
    });
  }

  private drawDrops(alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    for (const d of this.drops) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      if (d.stuck) ctx.ellipse(d.x, d.y, d.r * 1.7, d.r * 0.7, 0, 0, Math.PI * 2);
      else ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
