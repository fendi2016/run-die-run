import type { SubmitRunResponse } from '../../shared/runsApi';
import { requireButton, requireElement } from './domUtils';

// DOM-based (not Phaser) result screen shown after clearing a run (spec
// section 8), including the "CURSE THIS LEVEL?" prompt (spec section 14).
// Lives outside the canvas so it renders crisp text without fighting the
// game camera's zoom. Not a singleton like EditorToolbar/PreviewBackButton
// — GameScene constructs a fresh one on every create(), but it never binds
// a listener itself; `setRetryHandler`/`setCurseHandler` assign `.onclick`
// (replace, not stack) so repeated scene restarts can't accumulate
// duplicate handlers on the same static button.
export class RunResultOverlay {
  private readonly root = requireElement('run-result');
  private readonly streakEl = requireElement('run-result-streak');
  private readonly curseBtn = requireButton('run-result-curse-btn');
  private readonly leaderboardBtn = requireButton('run-result-leaderboard-btn');
  private readonly shareBtn = requireButton('run-result-share');

  private readonly saveStatus = requireElement('run-result-save-status');
  private readonly saveRetry = requireButton('run-result-save-retry');
  private readonly nextStatus = requireElement('run-result-next-status');
  private readonly nextButton = requireButton('run-result-next');
  private readonly titleEl = requireElement('run-result-title');
  private readonly curseHintEl = requireElement('run-result-curse-hint');

  showSaveStatus(message: string, retry?: () => void): void {
    this.saveStatus.classList.remove('run-result-info');
    this.saveStatus.textContent = message;
    this.saveRetry.classList.toggle('hidden', !retry);
    this.saveRetry.onclick = retry ?? null;
  }

  showNext(message: string, label?: string, action?: () => void): void {
    this.nextStatus.textContent = message;
    this.nextButton.textContent = label ?? 'Next Level';
    this.nextButton.classList.toggle('hidden', !action);
    this.nextButton.onclick = action ?? null;
  }

  // Shown immediately on finish, before the server round-trip resolves.
  showTime(): void {
    this.titleEl.textContent = 'CLEAR!';
    this.curseHintEl.classList.add('hidden');
    this.showSaveStatus('');
    this.showNext('');
    this.streakEl.textContent = '';
    this.curseBtn.classList.add('hidden');
    this.leaderboardBtn.classList.add('hidden');
    this.curseBtn.onclick = null;
    this.leaderboardBtn.onclick = null;
    this.shareBtn.classList.add('hidden');
    this.shareBtn.onclick = null;
    this.root.classList.remove('hidden');
  }

  showResult(result: SubmitRunResponse): void {
    this.streakEl.textContent = `Streak: ${result.streak}`;
    this.streakEl.classList.toggle('run-result-streak-increased', result.isNewStreakIncrease);
  }

  setCurseHandler(handler: () => void): void {
    this.curseBtn.classList.remove('hidden');
    this.curseHintEl.classList.remove('hidden');
    this.curseBtn.onclick = handler;
  }

  hideCurse(): void {
    this.curseBtn.classList.add('hidden');
    this.curseHintEl.classList.add('hidden');
    this.curseBtn.onclick = null;
  }

  // The tutorial's finish: explains the curse loop before the first real
  // level, with a button to go on (no timed auto-advance, so it gets read).
  showTutorialOutro(onContinue: () => void): void {
    this.titleEl.textContent = 'YOU MADE IT!';
    this.showSaveStatus(
      "Here's the twist: players build every level. Beat one and you get to leave your curse — one new trap that everyone after you has to survive. Then it's on to the next level."
    );
    this.saveStatus.classList.add('run-result-info');
    this.showNext('', 'Play a real level →', onContinue);
  }

  setShareHandler(handler: () => void): void {
    this.shareBtn.classList.remove('hidden');
    this.shareBtn.onclick = handler;
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
    this.curseBtn.onclick = null;
    this.leaderboardBtn.onclick = null;
    this.shareBtn.onclick = null;
    this.saveRetry.onclick = null;
    this.nextButton.onclick = null;
    this.root.classList.add('hidden');
  }
}
