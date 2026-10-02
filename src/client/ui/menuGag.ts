import { requireElement } from './domUtils';

// The menu's death gag, drawn on one canvas (#menu-gag) over the whole menu
// (shared by the feed card and game.html's menu): the pencil runs along
// Play's top edge into the saw and is split in half vertically: he winces
// and shakes against the blade, a crack opens down his middle, then the two
// halves (ui/menu-gag-split.webp, cut from the user's destruction sheet)
// topple apart onto Play with wood chips flying (ui/menu-gag-shavings.webp).
// Then it fades and he respawns with a poof. One rAF loop and plain drawImage/arc calls,
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
// Fraction of Play's width, but always leaving room past it for his right
// half to land on Play.
const SAW_AT = 0.72;
const SAW_RADIUS = 0.4; // of the runner's height
// Counter-clockwise (negative is anticlockwise on a y-down canvas). The 14
// teeth are ~26 degrees apart, so a turn faster than ~13 degrees a frame
// strobes and reads as spinning the wrong way: 1s a turn idle, and grinding
// as fast as 60fps allows.
const SAW_SPIN = (-Math.PI * 2) / 1.0;
const SAW_SPIN_GRINDING = (-Math.PI * 2) / 0.6;

// The split pieces in ui/menu-gag-split.webp, drawn for a 128px-tall
// pencil: source rect, and where each sits relative to his feet-centre
// (dx: its left edge; dy: its bottom). The halves keep their places from
// the user's sheet, so together they stand where the whole pencil stood.
type Piece = { sx: number; sy: number; w: number; h: number; dx: number; dy: number };
const PIECE_H = 128;
const WINCE: Piece = { sx: 0, sy: 1, w: 75, h: 128, dx: -37.5, dy: 0 };
const CRACK: Piece = { sx: 79, sy: 0, w: 72, h: 129, dx: -36, dy: 0 };
const LEFT_HALF: Piece = { sx: 155, sy: 4, w: 45, h: 125, dx: -42.7, dy: 0 };
const RIGHT_HALF: Piece = { sx: 204, sy: 13, w: 40, h: 116, dx: 2.7, dy: -8.3 };

const IMPACT_MS = 420;
const CRACK_MS = 520;
// While it cuts he keeps getting fed right through the blade, until his
// middle is on it and he comes apart.
const CUT_MS = IMPACT_MS + CRACK_MS;
const REST_MS = 900;
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

type Phase = 'run' | 'impact' | 'crack' | 'split' | 'rest' | 'fade';

// A half toppling over its outer foot: angle away from upright (radians),
// and its angular speed.
type Topple = { angle: number; spin: number };

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
    loadImage('/assets/ui/menu-gag-split.webp'),
    loadImage('/assets/ui/menu-gag-shavings.webp'),
  ])
    .then(([run, saw, poof, split, shavings]) =>
      new MenuGag(run, saw, poof, split, shavings).start()
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
  // Where he stopped against the saw, and the two halves once split.
  private hitX = 0;
  private topple = { left: { angle: 0, spin: 0 }, right: { angle: 0, spin: 0 } };
  // Where he was when he hit the blade (the feed starts there).
  private cutFromX = 0;
  private shavings: Shaving[] = [];

  constructor(
    private readonly runImage: HTMLImageElement,
    private readonly sawImage: HTMLImageElement,
    private readonly poofImage: HTMLImageElement,
    private readonly splitImage: HTMLImageElement,
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
    const sawX = Math.min(l.playLeft + l.playWidth * SAW_AT, l.playLeft + l.playWidth - h * 1.05);
    // Mostly out of Play, so it's a big blade to run into.
    const sawY = feetY - sawR * 0.15;

    if (this.reducedMotion) {
      this.drawSaw(l, sawX, sawY, sawR, 0);
      this.drawWhole(l.playLeft + l.playWidth * 0.3, feetY, w, h, 0);
      return;
    }

    this.sawAngle +=
      dt * (this.phase === 'impact' || this.phase === 'crack' ? SAW_SPIN_GRINDING : SAW_SPIN);
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
          // Whole poses stand on their own feet-centre; put his front edge
          // where the runner's was.
          this.hitX = hitX + w * 0.5 - (WINCE.w + WINCE.dx) * (h / PIECE_H) - h * 0.12;
          this.cutFromX = this.hitX;
          this.emitShavings(sawX - sawR * 0.9, feetY - h * 0.5, h, 1, 14);
          this.enter('impact', now);
        }
        break;
      }
      case 'impact': {
        // Thunk: knocked back a hair, then fed on into the blade, shaking.
        const recoil = t < 90 ? -(t / 90) * h * 0.06 : -h * 0.06 * (1 - clamp01((t - 90) / 200));
        const shake = t > 90 ? Math.sin(now / 4) * 1.5 : 0;
        const x = this.feedX(sawX, t);
        this.drawPieceAt(WINCE, x + recoil + shake, feetY, h);
        if (t > 90) this.emitShavings(sawX - sawR * 0.5, feetY - h * 0.5, h, dt, 30);
        if (t >= IMPACT_MS) this.enter('crack', now);
        break;
      }
      case 'crack': {
        // The crack runs down his middle; he shakes harder.
        const shake = Math.sin(now / 3.5) * (1.5 + 1.5 * clamp01(t / CRACK_MS));
        const x = this.feedX(sawX, IMPACT_MS + t);
        this.drawPieceAt(CRACK, x + shake, feetY, h);
        this.emitShavings(sawX - sawR * 0.5, feetY - h * (0.2 + 0.6 * Math.random()), h, dt, 45);
        if (t >= CRACK_MS) {
          // Through: one half each side of the blade, each kicked over its
          // outer foot, away from it.
          this.hitX = sawX;
          this.topple = { left: { angle: 0, spin: 2.2 }, right: { angle: 0, spin: 2.2 } };
          this.emitShavings(sawX, feetY - h * 0.5, h, 1, 22);
          this.enter('split', now);
        }
        break;
      }
      case 'split':
      case 'rest':
      case 'fade': {
        if (this.phase === 'split') {
          const leftDown = this.stepTopple(this.topple.left, dt);
          const rightDown = this.stepTopple(this.topple.right, dt);
          const settled = leftDown && rightDown;
          if (t < 250) this.emitShavings(this.hitX, feetY - h * 0.4, h, dt, 60);
          if (settled || t > 1500) this.enter('rest', now);
        } else if (this.phase === 'rest' && t >= REST_MS) {
          this.enter('fade', now);
        }
        const alpha = this.phase === 'fade' ? 1 - clamp01(t / FADE_MS) : 1;
        ctx.globalAlpha = alpha;
        this.drawHalf(LEFT_HALF, -1, this.topple.left.angle, this.hitX, feetY, h);
        this.drawHalf(RIGHT_HALF, 1, this.topple.right.angle, this.hitX, feetY, h);
        ctx.globalAlpha = 1;
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

  // A whole pose standing at (x, feetY), scaled to the runner's height.
  private drawPieceAt(piece: Piece, x: number, feetY: number, h: number): void {
    const k = h / PIECE_H;
    this.ctx.drawImage(
      this.splitImage,
      piece.sx,
      piece.sy,
      piece.w,
      piece.h,
      x + piece.dx * k,
      feetY + piece.dy * k - piece.h * k,
      piece.w * k,
      piece.h * k
    );
  }

  // One half, toppled `angle` outward (side -1 left, 1 right) about its
  // outer bottom corner, which stays planted on Play.
  private drawHalf(piece: Piece, side: number, angle: number, x: number, feetY: number, h: number): void {
    const ctx = this.ctx;
    const k = h / PIECE_H;
    const left = x + piece.dx * k;
    const bottom = feetY + piece.dy * k;
    const pivotX = side < 0 ? left : left + piece.w * k;
    ctx.save();
    ctx.translate(pivotX, bottom);
    ctx.rotate(side * angle);
    ctx.translate(-pivotX, -bottom);
    ctx.drawImage(this.splitImage, piece.sx, piece.sy, piece.w, piece.h, left, bottom - piece.h * k, piece.w * k, piece.h * k);
    ctx.restore();
  }

  // His feet-centre `t` ms into the cut: fed steadily from where he hit
  // until his middle is on the blade.
  private feedX(sawX: number, t: number): number {
    return this.cutFromX + (sawX - this.cutFromX) * clamp01(t / CUT_MS);
  }

  // Falls over like a plank (faster the further it leans), thuds flat,
  // bounces a little. Returns true once it's lying still.
  private stepTopple(half: Topple, dt: number): boolean {
    const flat = Math.PI / 2;
    half.spin += (9 * Math.sin(half.angle) + 1.5) * dt;
    half.angle += half.spin * dt;
    if (half.angle >= flat) {
      half.angle = flat;
      half.spin = -half.spin * 0.28;
      if (Math.abs(half.spin) < 0.6) {
        half.spin = 0;
        return true;
      }
    }
    return false;
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
        size: (7 + Math.random() * 8) * k,
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
