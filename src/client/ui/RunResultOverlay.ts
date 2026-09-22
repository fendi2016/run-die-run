import { CURRENCY_NAME } from '../../shared/constants';
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
  private readonly streakEl = requireElement('run-result-streak');
  private readonly currencyEl = requireElement('run-result-currency');
  private readonly retryBtn = requireButton('run-result-retry-btn');
  private readonly curseBtn = requireButton('run-result-curse-btn');
  private readonly leaderboardBtn = requireButton('run-result-leaderboard-btn');

  // Shown immediately on finish, before the server round-trip resolves, so
  // the player sees their time instantly rather than waiting on network.
  showTime(timeMs: number): void {
    this.timeEl.textContent = formatSeconds(timeMs);
    this.rankEl.textContent = '';
    this.pbEl.textContent = '';
    this.wrEl.textContent = '';
    this.streakEl.textContent = '';
    this.currencyEl.textContent = '';
    this.retryBtn.classList.add('hidden');
    this.curseBtn.classList.add('hidden');
    this.leaderboardBtn.classList.add('hidden');
    this.retryBtn.onclick = null;
    this.curseBtn.onclick = null;
    this.leaderboardBtn.onclick = null;
    this.root.classList.remove('hidden');
  }

  showResult(result: SubmitRunResponse): void {
    this.rankEl.textContent = `#${result.rank} on this version`;
    this.pbEl.textContent = `Personal Best: ${formatSeconds(result.personalBestMs)}`;
    this.wrEl.textContent = `World Record: ${formatSeconds(result.worldRecordMs)}`;
    this.streakEl.textContent = `CURRENT SURVIVAL STREAK: ${result.streak} VERSION${result.streak === 1 ? '' : 'S'}`;
    this.streakEl.classList.toggle('run-result-streak-increased', result.isNewStreakIncrease);
    this.currencyEl.textContent =
      result.currencyAwarded > 0
        ? `+${result.currencyAwarded} ${CURRENCY_NAME} (${result.currencyBalance} total)`
        : '';
  }

  setRetryHandler(handler: () => void): void {
    this.retryBtn.classList.remove('hidden');
    this.retryBtn.onclick = handler;
  }

  setCurseHandler(handler: () => void): void {
    this.curseBtn.classList.remove('hidden');
    this.curseBtn.onclick = handler;
  }

  setLeaderboardHandler(handler: () => void): void {
    this.leaderboardBtn.classList.remove('hidden');
    this.leaderboardBtn.onclick = handler;
  }

  // Drops the button handlers as well as showing the hidden state. They
  // close over the GameScene that set them, and `hide()` runs from that
  // scene's own `shutdown` cleanup — leaving them bound means a stray tap
  // during the fade-out calls `restartRun()` on an already-destroyed scene
  // (its Player's Arcade body is gone by then, so `reset()` throws).
  hide(): void {
    this.retryBtn.onclick = null;
    this.curseBtn.onclick = null;
    this.leaderboardBtn.onclick = null;
    this.root.classList.add('hidden');
  }
}
