import { requireElement } from './domUtils';

// The menu's death gag, drawn on one canvas (#menu-gag) over the whole menu
// (shared by the feed card and game.html's menu): the pencil runs along
// Play's top edge, trips onto the saw and ends up hunched over the blade,
// which slowly cuts him in half at the waist while blood sprays all over
// the card; the two pieces drop off either side, everything fades, he
// respawns with a poof. One rAF loop and
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
const SAW_RADIUS = 0.4; // of the runner's height
// Counter-clockwise (negative is anticlockwise on a y-down canvas).
const SAW_SPIN = (-Math.PI * 2) / 0.6;
const SAW_SPIN_CUTTING = (-Math.PI * 2) / 0.25;

const TRIP_MS = 220;
const CUT_MS = 1600;
const FALL_MS = 450;
const HOLD_MS = 700;
const FADE_MS = 350;
const POOF_MS = 350;
const POOF_FRAMES = 7;
// Hunched over the blade: clockwise turn of each piece from upright. The
// top half folds forward over the saw (head hanging down the far side),
// the legs trail back down the near side — and both droop further as the
// blade sinks in.
const HUNCH_TOP = 2.3;
const HUNCH_LEGS = 0.8;
const DROOP = 0.2;
// A piece lying flat sits this much of the frame width above Play (the
// pencil art is narrower than its frame).
const REST_LIFT = 0.3;

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

type Phase = 'run' | 'trip' | 'cut' | 'fall' | 'hold' | 'fade';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`menu gag: ${src} failed to load`));
    image.src = src;
  });
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
  // His pose when he hit the saw, and Play's top edge this frame.
  private frame = 0;
  private floorY = 0;
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
    this.floorY = feetY + 1;
    const spawnX = l.playLeft + w * 0.35;
    const sawRestX = l.playLeft + l.playWidth * SAW_AT;
    // Mostly out of Play, so there's a blade for him to fold over.
    const sawRestY = feetY - sawR * 0.15;

    if (this.reducedMotion) {
      this.drawSaw(l, sawRestX, sawRestY, sawR, 0);
      this.drawWhole(l.playLeft + l.playWidth * 0.3, feetY, w, h, 0);
      return;
    }

    this.sawAngle += dt * (this.phase === 'cut' ? SAW_SPIN_CUTTING : SAW_SPIN);
    // The saw behind him; where it's cutting, a sliver of blade is drawn
    // again over his waist (below) so it reads as going through him.
    this.drawSaw(l, sawRestX, sawRestY, sawR, this.sawAngle);
    // Blood behind him too, so it flies out from behind the body instead of
    // burying it.
    this.updateDrops(l, dt, h);
    this.drawDrops(this.phase === 'fade' ? 1 - clamp01(t / FADE_MS) : 1);
    let waist: { x: number; y: number } | undefined;
    // He stops when his front foot meets the teeth.
    const hitX = sawRestX - sawR - w * 0.25;
    // Hunched: his waist rests on top of the blade, then sinks to its hub.
    const bladeTop = sawRestY - sawR * 0.9;
    const upright = { x: hitX, y: feetY - h / 2, top: 0, legs: 0 };
    const hunched = { x: sawRestX, y: bladeTop, top: HUNCH_TOP, legs: HUNCH_LEGS };
    let fade = 1;

    switch (this.phase) {
      case 'run': {
        const speed = h * RUN_HEIGHTS_PER_S;
        const x = Math.min(spawnX + (t / 1000) * speed, hitX);
        const travelled = x - spawnX;
        this.frame = Math.floor((travelled / (h * STRIDE_PER_HEIGHT)) * RUN_FRAMES) % RUN_FRAMES;
        if (t < POOF_MS) this.drawPoof(spawnX, feetY, h, t);
        this.drawWhole(x, feetY, w, h, this.frame);
        if (x >= hitX) this.enter('trip', now);
        break;
      }
      case 'trip': {
        // Pitches forward and lands folded over the blade.
        const p = easeOut(clamp01(t / TRIP_MS));
        const x = upright.x + (hunched.x - upright.x) * p;
        const y = upright.y + (hunched.y - upright.y) * p - Math.sin(p * Math.PI) * h * 0.2;
        this.drawBody(x, y, w, h, upright.top + (hunched.top - upright.top) * p, upright.legs + (hunched.legs - upright.legs) * p, 0);
        if (p > 0.6) waist = { x, y };
        if (t >= TRIP_MS) this.enter('cut', now);
        break;
      }
      case 'cut': {
        // The blade slowly sinks into his middle; he twitches; blood goes
        // everywhere; the two halves start to come apart.
        const p = clamp01(t / CUT_MS);
        // Partway into the blade, not to the hub, so he stays on top of Play.
        const y = hunched.y + (sawRestY - hunched.y) * 0.5 * p;
        const shake = Math.sin(now / 6) * 1.8;
        const gap = p * p * w * 0.25;
        this.drawBody(
          hunched.x + shake,
          y + Math.cos(now / 9) * 1.2,
          w,
          h,
          hunched.top + DROOP * p,
          hunched.legs + DROOP * p,
          gap
        );
        this.spray(hunched.x, y, h, dt, 560);
        waist = { x: hunched.x, y };
        if (t >= CUT_MS) this.enter('fall', now);
        break;
      }
      case 'fall': {
        // Cut through: each piece slides off its side of the blade and lands
        // flat on Play.
        const p = easeIn(clamp01(t / FALL_MS));
        const startY = sawRestY;
        const restY = feetY - w * REST_LIFT;
        const topAngle = hunched.top + DROOP;
        const legsAngle = hunched.legs + DROOP;
        this.drawPiece('top', sawRestX + w * 0.25 + p * sawR * 1.4, startY + (restY - startY) * p, w, h, topAngle + (Math.PI / 2 - topAngle) * p);
        this.drawPiece('legs', sawRestX - w * 0.25 - p * sawR * 1.4, startY + (restY - startY) * p, w, h, legsAngle + (Math.PI / 2 - legsAngle) * p);
        this.spray(sawRestX, sawRestY - sawR * 0.5, h, dt, 300 * (1 - p));
        if (t >= FALL_MS) this.enter('hold', now);
        break;
      }
      case 'hold':
      case 'fade': {
        if (this.phase === 'fade') fade = 1 - clamp01(t / FADE_MS);
        const restY = feetY - w * REST_LIFT;
        ctx.globalAlpha = fade;
        this.drawPiece('top', sawRestX + w * 0.25 + sawR * 1.4, restY, w, h, Math.PI / 2);
        this.drawPiece('legs', sawRestX - w * 0.25 - sawR * 1.4, restY, w, h, Math.PI / 2);
        ctx.globalAlpha = 1;
        if (this.phase === 'hold') {
          this.spray(sawRestX, sawRestY - sawR * 0.5, h, dt, 50);
          if (t >= HOLD_MS) this.enter('fade', now);
        } else if (t >= FADE_MS) {
          this.drops = [];
          this.enter('run', now);
        }
        break;
      }
    }

    if (waist) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(waist.x - sawR * 0.3, waist.y - h * 0.3, sawR * 0.6, h * 0.3 + 3);
      ctx.clip();
      this.drawSaw(l, sawRestX, sawRestY, sawR, this.sawAngle);
      ctx.restore();
    }
  }

  // One run-strip frame, bottom-centre at (x, feetY).
  private drawWhole(x: number, feetY: number, w: number, h: number, frame: number): void {
    this.ctx.drawImage(this.runImage, frame * FRAME_W, 0, FRAME_W, FRAME_H, x - w / 2, feetY - h, w, h);
  }

  // His body bent at the waist (x, y): the top half turned `topAngle` and
  // the legs `legsAngle` clockwise from upright, `gap` apart at the cut.
  private drawBody(
    x: number,
    y: number,
    w: number,
    h: number,
    topAngle: number,
    legsAngle: number,
    gap: number
  ): void {
    this.drawPiece('legs', x - gap / 2, y, w, h, legsAngle);
    this.drawPiece('top', x + gap / 2, y, w, h, topAngle);
  }

  // Half of the pose at hit time, pivoting on its cut edge at the waist.
  // Play is the floor: nothing of him hangs over its face.
  private drawPiece(half: 'top' | 'legs', x: number, y: number, w: number, h: number, angle: number): void {
    const ctx = this.ctx;
    const sy = half === 'top' ? 0 : FRAME_H / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ctx.canvas.width, this.floorY);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(
      this.runImage,
      this.frame * FRAME_W,
      sy,
      FRAME_W,
      FRAME_H / 2,
      -w / 2,
      half === 'top' ? -h / 2 : 0,
      w,
      h / 2
    );
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

  // Blood out of the cut: mostly up and sideways, fast, all over the card.
  private spray(x: number, y: number, h: number, dt: number, perSecond: number): void {
    const k = h / 56;
    let count = perSecond * dt;
    while (count > 0 && this.drops.length < MAX_DROPS) {
      if (count < 1 && Math.random() > count) break;
      count -= 1;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = (380 + Math.random() * 620) * k;
      const big = Math.random() < 0.06;
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
