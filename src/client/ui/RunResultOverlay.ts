import type { SubmitRunResponse } from '../../shared/runsApi';
import { requireButton, requireElement } from './domUtils';

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

// DOM-based (not Phaser) result screen shown after clearing a run (spec
// section 8), including the "CURSE THIS LEVEL?" prompt (spec section 14).
// Lives outside the canvas so it renders crisp text without fighting the
// game camera's zoom. Not a singleton like EditorToolbar/PreviewBackButton
// — GameScene constructs a fresh one on every create(), but it never binds
// a listener itself; `setRetryHandler`/`setCurseHandler` assign `.onclick`
// (replace, not stack) so repeated scene restarts can't accumulate
// duplicate handlers on the same static buttons.
export class RunResultOverlay {
  private readonly root = requireElement('run-result');
  private readonly timeEl = requireElement('run-result-time');
  private readonly rankEl = requireElement('run-result-rank');
  private readonly pbEl = requireElement('run-result-pb');
  private readonly wrEl = requireElement('run-result-wr');
  private readonly retryBtn = requireButton('run-result-retry-btn');
  private readonly curseBtn = requireButton('run-result-curse-btn');

  // Shown immediately on finish, before the server round-trip resolves, so
  // the player sees their time instantly rather than waiting on network.
  showTime(timeMs: number): void {
    this.timeEl.textContent = formatSeconds(timeMs);
    this.rankEl.textContent = '';
    this.pbEl.textContent = '';
    this.wrEl.textContent = '';
    this.retryBtn.classList.add('hidden');
    this.curseBtn.classList.add('hidden');
    this.retryBtn.onclick = null;
    this.curseBtn.onclick = null;
    this.root.classList.remove('hidden');
  }

  showResult(result: SubmitRunResponse): void {
    this.rankEl.textContent = `#${result.rank} on this version`;
    this.pbEl.textContent = `Personal Best: ${formatSeconds(result.personalBestMs)}`;
    this.wrEl.textContent = `World Record: ${formatSeconds(result.worldRecordMs)}`;
  }

  setRetryHandler(handler: () => void): void {
    this.retryBtn.classList.remove('hidden');
    this.retryBtn.onclick = handler;
  }

  setCurseHandler(handler: () => void): void {
    this.curseBtn.classList.remove('hidden');
    this.curseBtn.onclick = handler;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
