import { requireElement } from './domUtils';

const BEST_PROGRESS_KEY_PREFIX = 'sketchy:best:';

function bestProgressKey(levelId: string, version: number): string {
  return `${BEST_PROGRESS_KEY_PREFIX}${levelId}:${version}`;
}

// Per-viewer "best so far" progress through a level, kept in localStorage
// only (never synced to the server) so RunHud can show a mark even across
// sessions. localStorage can throw in private browsing and some preview
// iframes, so every access here is wrapped, and a missing/corrupt/
// out-of-range value is just treated as "no best" rather than crashing.
export function loadBestProgress(levelId: string, version: number): number | null {
  try {
    const raw = localStorage.getItem(bestProgressKey(levelId, version));
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveBestProgress(levelId: string, version: number, fraction: number): void {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return;
  // Reads through loadBestProgress, which has its own try/catch, so a
  // storage failure here just falls through to "no existing best".
  const existing = loadBestProgress(levelId, version);
  if (existing !== null && fraction <= existing) return;
  try {
    localStorage.setItem(bestProgressKey(levelId, version), String(fraction));
  } catch {
    // Best-so-far is a nice-to-have; a lost write isn't worth surfacing.
  }
}

// Gameplay HUD: an attempt counter (top-left) and a thin level-progress bar
// across the top of the screen, with a tick marking the best-so-far point.
// The progress bar is currently switched off (see SHOW_PROGRESS_BAR).
// Entirely `pointer-events: none` — taps anywhere on the gameplay area are
// the jump input, same as #run-result/#death-panel. GameScene is expected
// to call setProgress() every frame, so that path stays cheap: it only
// touches the DOM when the rounded percentage actually changes, and moves
// the fill with `transform: scaleX` instead of `width` to avoid layout.
// Kenney scribble digits (public/assets/kenney/ui/ui-num-<0-9>.webp) —
// the attempt counter renders the number as a row of these instead of
// text, one <img> per digit, rebuilt on every change since an attempt
// number is a handful of updates per run, not a hot per-frame path (unlike
// setProgress() below).
function digitImageSrc(digit: string): string {
  return `/assets/kenney/ui/ui-num-${digit}.webp`;
}

// The level-progress bar is switched OFF on purpose (user request,
// 2026-09-29: "I don't want it in the game"). Its markup, CSS and the
// setProgress()/setBest() code below are kept so it can come back by
// flipping this flag. Best-progress is still saved (GameScene uses it for
// the First Blood offer); it just isn't drawn.
const SHOW_PROGRESS_BAR = false;

export class RunHud {
  private readonly root = requireElement('run-hud');
  private readonly attemptNumberEl = requireElement('run-hud-attempt-number');
  private readonly attemptDigitsEl = requireElement('run-hud-attempt-digits');
  private readonly fillEl = requireElement('run-hud-progress-fill');
  private readonly bestMarkEl = requireElement('run-hud-progress-best');
  private readonly pctEl = requireElement('run-hud-progress-pct');
  private readonly progressRowEl = requireElement('run-hud-progress-row');
  private lastAttempt: number | undefined;
  private lastPercent = -1;

  show(): void {
    this.root.classList.remove('hidden');
    this.progressRowEl.classList.toggle('hidden', !SHOW_PROGRESS_BAR);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setAttempt(n: number): void {
    if (n === this.lastAttempt) return;
    this.lastAttempt = n;
    const digits = String(n);
    // The digit images are decorative (aria-hidden — see game.html); this
    // aria-label on the container is the one accessible text equivalent
    // for the number itself.
    this.attemptNumberEl.setAttribute('aria-label', digits);
    this.attemptDigitsEl.replaceChildren(
      ...digits.split('').map((digit) => {
        const img = document.createElement('img');
        img.className = 'run-hud-attempt-digit';
        img.src = digitImageSrc(digit);
        img.alt = '';
        return img;
      })
    );
    // Restart the punch animation even if one is already mid-play: clearing
    // the class and reading offsetWidth forces a synchronous reflow before
    // it's re-added, which is what actually restarts a CSS animation on the
    // same element (re-adding the class alone would be a no-op).
    this.attemptNumberEl.classList.remove('run-hud-attempt-punch');
    void this.attemptNumberEl.offsetWidth;
    this.attemptNumberEl.classList.add('run-hud-attempt-punch');
  }

  setProgress(fraction: number): void {
    if (!SHOW_PROGRESS_BAR) return;
    const clamped = Math.min(1, Math.max(0, fraction));
    const percent = Math.round(clamped * 100);
    if (percent === this.lastPercent) return;
    this.lastPercent = percent;
    this.fillEl.style.transform = `scaleX(${clamped})`;
    this.pctEl.textContent = `${percent}%`;
  }

  setBest(fraction: number | null): void {
    if (!SHOW_PROGRESS_BAR) return;
    if (fraction === null) {
      this.bestMarkEl.classList.add('hidden');
      return;
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    this.bestMarkEl.style.left = `${clamped * 100}%`;
    this.bestMarkEl.classList.remove('hidden');
  }
}
