import type { ObjectType } from '../../shared/types';
import { requireButton, requireElement } from './domUtils';
import { labelFor } from '../../shared/objectLabels';

// DOM-based death screen, shown on every death instead of the old
// auto-restart timer — the run only resumes once the player taps Retry.
// Attribution ("Killed by u/X's Saw — this trap has N kills") shows above
// the Retry button when a hazard is to blame. Follow-the-subreddit lives
// on the main menus (splash.html's card and game.html's #game-menu) only,
// not here — dying isn't the moment to ask.
export class DeathPanel {
  private readonly root = requireElement('death-panel');
  private readonly attributionEl = requireElement('death-panel-attribution');
  private readonly killsEl = requireElement('death-panel-kills');
  private readonly retryBtn = requireButton('death-panel-retry-btn');
  private token = 0;

  // `addedBy`/`type` absent for a fall-death or a seed-level trap — no
  // attribution to show, but Retry still needs to appear. Returns a token
  // for gating a later `setKillCount` against a newer death.
  show(addedBy?: string, type?: ObjectType): number {
    const shownToken = ++this.token;
    if (addedBy && type) {
      this.attributionEl.textContent = `Killed by u/${addedBy}'s ${labelFor(type)}`;
      this.attributionEl.classList.remove('hidden');
    } else {
      this.attributionEl.textContent = '';
      this.attributionEl.classList.add('hidden');
    }
    this.killsEl.textContent = '';
    this.root.classList.remove('hidden');
    return shownToken;
  }

  setKillCount(shownToken: number, kills: number): void {
    if (shownToken !== this.token) {
      // A newer death has already replaced this panel — don't resurrect it.
      return;
    }
    this.killsEl.textContent = `This trap has ${kills} kill${kills === 1 ? '' : 's'}.`;
  }

  setRetryHandler(handler: () => void): void {
    this.retryBtn.onclick = handler;
  }

  hide(): void {
    this.token++;
    this.root.classList.add('hidden');
  }
}
