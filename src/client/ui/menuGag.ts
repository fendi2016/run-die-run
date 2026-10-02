import { requireElement } from './domUtils';

// The menu's death gag, drawn on one canvas (#menu-gag) over the whole menu
// (shared by the feed card and game.html's menu): the pencil runs along
// Play's top edge, hops onto the saw, and gets sharpened — wood shavings
// fly everywhere and pile up on Play while he grinds shorter and shorter,
// until only his eraser pops out and bounces away. Then the shavings fade
// and he respawns with a poof. One rAF loop and plain drawImage/arc calls,
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

const HOP_MS = 280;
const GRIND_MS = 1800;
const ERASER_MS = 1500;
const FADE_MS = 400;
const POOF_MS = 350;
const POOF_FRAMES = 7;
// The eraser and its metal band: the top of every run frame.
const ERASER_FRAC = 0.3;

const WOOD = '#e9c58f';
const WOOD_EDGE = '#a8743c';
const PAINT = '#f6c21c';
const GRAPHITE = '#4a4a4a';
const MAX_SHAVINGS = 260;

type Shaving = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  // Curl colour: bare wood, painted edge, or a fleck of graphite.
  kind: 'wood' | 'paint' | 'graphite';
  stuck: boolean;
};

type Eraser = { x: number; y: number; vx: number; vy: number; angle: number; spin: number };

type Layout = {
  dpr: number;
  width: number;
  height: number;
  playLeft: number;
  playTop: number;
  playWidth: number;
  runnerH: number;
};

type Phase = 'run' | 'hop' | 'grind' | 'eraser' | 'fade';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`menu gag: ${src} failed to load`));
    image.src = src;
  });
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
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
  // His pose when he hit the saw, where he hopped from, and the eraser
  // once it pops free.
  private frame = 0;
  private hitX = 0;
  private eraser: Eraser | undefined;
  private shavings: Shaving[] = [];

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
    const sawX = l.playLeft + l.playWidth * SAW_AT;
    // Mostly out of Play, so there's a blade to stand on.
    const sawY = feetY - sawR * 0.15;
    // Where he stands on the blade: its top, a little into the teeth.
    const bladeTop = sawY - sawR * 0.8;

    if (this.reducedMotion) {
      this.drawSaw(l, sawX, sawY, sawR, 0);
      this.drawWhole(l.playLeft + l.playWidth * 0.3, feetY, w, h, 0);
      return;
    }

    this.sawAngle += dt * (this.phase === 'grind' ? SAW_SPIN_GRINDING : SAW_SPIN);
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
          this.enter('hop', now);
        }
        break;
      }
      case 'hop': {
        // Boing — up and onto the top of the blade.
        const p = clamp01(t / HOP_MS);
        const x = this.hitX + (sawX - this.hitX) * easeOut(p);
        const y = feetY + (bladeTop - feetY) * p - Math.sin(p * Math.PI) * h * 0.55;
        this.drawWhole(x, y, w, h, this.frame);
        if (t >= HOP_MS) this.enter('grind', now);
        break;
      }
      case 'grind': {
        // Sharpened from the feet up: he sinks into the blade (only what's
        // above it is drawn) until just the eraser is left.
        const p = clamp01(t / GRIND_MS);
        const eaten = h * (1 - ERASER_FRAC) * p;
        const jitter = Math.sin(now / 5) * 1.6;
        this.drawEaten(sawX + jitter, bladeTop + eaten, w, h, bladeTop);
        this.emitShavings(sawX, bladeTop, h, dt, 110);
        if (t >= GRIND_MS) {
          // Pop! The eraser shoots up and back across Play.
          this.eraser = {
            x: sawX,
            y: bladeTop - h * ERASER_FRAC * 0.5,
            vx: -h * 2.2,
            vy: -h * 9,
            angle: 0,
            spin: -14,
          };
          this.enter('eraser', now);
        }
        break;
      }
      case 'eraser': {
        this.updateEraser(l, dt, h);
        this.drawEraser(w, h, 1);
        if (t >= ERASER_MS) this.enter('fade', now);
        break;
      }
      case 'fade': {
        this.drawEraser(w, h, 1 - clamp01(t / FADE_MS));
        if (t >= FADE_MS) {
          this.shavings = [];
          this.eraser = undefined;
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

  // The frozen pose with its feet at feetY, drawn only above cutY.
  private drawEaten(x: number, feetY: number, w: number, h: number, cutY: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - w, feetY - h - 2, w * 2, cutY - (feetY - h) + 2);
    ctx.clip();
    this.drawWhole(x, feetY, w, h, this.frame);
    ctx.restore();
  }

  // Bounces along Play's top, then rolls/falls off wherever it goes.
  private updateEraser(l: Layout, dt: number, h: number): void {
    const e = this.eraser;
    if (!e) return;
    const k = h / 56;
    const radius = h * ERASER_FRAC * 0.35;
    e.vy += 1500 * k * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.angle += e.spin * dt;
    const onPlay = e.x > l.playLeft && e.x < l.playLeft + l.playWidth;
    if (onPlay && e.vy > 0 && e.y + radius >= l.playTop) {
      e.y = l.playTop - radius;
      e.vy = -e.vy * 0.55;
      e.vx *= 0.8;
      e.spin *= 0.7;
    }
  }

  private drawEraser(w: number, h: number, alpha: number): void {
    const e = this.eraser;
    if (!e) return;
    const ctx = this.ctx;
    const sh = FRAME_H * ERASER_FRAC;
    const dh = h * ERASER_FRAC;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.drawImage(this.runImage, this.frame * FRAME_W, 0, FRAME_W, sh, -w / 2, -dh / 2, w, dh);
    ctx.restore();
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
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const speed = (220 + Math.random() * 420) * k;
      const roll = Math.random();
      this.shavings.push({
        x: x + (Math.random() - 0.5) * 6,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (2.5 + Math.random() * 3) * k,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 18,
        kind: roll < 0.15 ? 'graphite' : roll < 0.45 ? 'paint' : 'wood',
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
        s.y = l.playTop - s.size * 0.3;
        s.stuck = true;
        return true;
      }
      return s.y < l.height + 10 && s.x > -10 && s.x < l.width + 10;
    });
  }

  // Each shaving is a little curl: a thick arc of wood with a darker rim
  // (a painted yellow edge on some), or a dot of graphite.
  private drawShavings(alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (const s of this.shavings) {
      if (s.kind === 'graphite') {
        ctx.fillStyle = GRAPHITE;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, s.angle, s.angle + Math.PI * 1.3);
      ctx.strokeStyle = WOOD_EDGE;
      ctx.lineWidth = s.size * 0.75;
      ctx.stroke();
      ctx.strokeStyle = s.kind === 'paint' ? PAINT : WOOD;
      ctx.lineWidth = s.size * 0.45;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
