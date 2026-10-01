import type { SubmitRunResponse } from '../../shared/runsApi';
import { requireButton, requireElement } from './domUtils';

export type RunResultDock = 'left' | 'top' | 'bottom';
const RUN_RESULT_DOCKS: readonly RunResultDock[] = ['left', 'top', 'bottom'];

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
  private readonly panel = requireElement('run-result-panel');
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
    this.root.classList.remove('run-result-curse-only');
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

  // While the curse is on offer the card is just the curse button and its
  // hint — everything below them hides so the card stays small enough to
  // watch the finish dive behind it.
  setCurseHandler(handler: () => void): void {
    this.curseBtn.classList.remove('hidden');
    this.curseHintEl.classList.remove('hidden');
    this.root.classList.add('run-result-curse-only');
    this.curseBtn.onclick = handler;
  }

  hideCurse(): void {
    this.curseBtn.classList.add('hidden');
    this.curseHintEl.classList.add('hidden');
    this.root.classList.remove('run-result-curse-only');
    this.curseBtn.onclick = null;
  }

  // The tutorial's finish: explains the curse loop, then hands the player
  // the same green Add a trap button a real clear shows, to try it here
  // (no timed auto-advance, so it gets read).
  showTutorialOutro(onAddTrap: () => void): void {
    this.titleEl.textContent = 'YOU MADE IT!';
    this.showSaveStatus(
      "Here's the twist: players build every level. Beat one and you get to sabotage it — one new trap that everyone after you has to survive. Try it on this one."
    );
    this.saveStatus.classList.add('run-result-info');
    this.setCurseHandler(onAddTrap);
  }

  // After the tutorial's practice trap is proven: the loop, said once more
  // now that they've done it, then on to a real level.
  showTutorialCurseOutro(onContinue: () => void): void {
    this.titleEl.textContent = 'SABOTAGED!';
    this.showSaveStatus(
      "That's the game: beat a level, add a trap, and everyone after you has to survive it. This one was practice — on real levels, your trap stays."
    );
    this.saveStatus.classList.add('run-result-info');
    this.showNext('', 'Play a real level →', onContinue);
  }

  // Where the card sits so it doesn't cover the player and the finish
  // sharpener: the left side on a wide screen, or whichever of top/bottom
  // the finish isn't on in portrait. GameScene pans the camera into the
  // space that's left (see frameFinish()).
  dock(side: RunResultDock): void {
    for (const each of RUN_RESULT_DOCKS) {
      this.root.classList.toggle(`run-result-dock-${each}`, each === side);
    }
  }

  panelRect(): DOMRect {
    return this.panel.getBoundingClientRect();
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
