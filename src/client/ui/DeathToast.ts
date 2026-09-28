import type { ObjectType } from '../../shared/types';
import { requireElement } from './domUtils';
import { labelFor } from '../../shared/objectLabels';

// How long the toast stays up. Longer than the respawn delay on purpose:
// the run restarts underneath it, so dying never waits on reading it.
const TOAST_MS = 1600;

// Non-blocking death toast. Death respawns on its own (GameScene), so this
// only reports what happened — "Killed by u/X's Saw", then the trap's kill
// count once the fire-and-forget report comes back. pointer-events: none,
// so taps pass straight through to the canvas as jumps.
// Onboarding: the first death of a session carries the one control tip.
// Kept at module scope because GameScene builds a fresh DeathToast per
// create().
const TIPS = ['Tip: hold to jump higher.'];
let sessionDeaths = 0;

export class DeathToast {
  private readonly root = requireElement('death-toast');
  private readonly attributionEl = requireElement('death-toast-attribution');
  private readonly killsEl = requireElement('death-toast-kills');
  private readonly tipEl = requireElement('death-toast-tip');
  private token = 0;
  private hideTimer: number | undefined;

  // `addedBy`/`type` absent for a fall-death or a seed-level trap. Returns
  // a token for gating a later `setKillCount` against a newer death.
  show(addedBy?: string, type?: ObjectType): number {
    const shownToken = ++this.token;
    const tip = TIPS[sessionDeaths] ?? '';
    sessionDeaths++;
    const attribution = addedBy && type ? `Killed by u/${addedBy}'s ${labelFor(type)}` : '';
    this.attributionEl.textContent = attribution;
    this.attributionEl.classList.toggle('hidden', attribution === '');
    this.killsEl.textContent = '';
    this.tipEl.textContent = tip;
    this.tipEl.classList.toggle('hidden', tip === '');
    window.clearTimeout(this.hideTimer);
    // Nothing to say (a fall, or a seed trap after the tip) — stay hidden.
    if (attribution === '' && tip === '') {
      this.root.classList.add('hidden');
      return shownToken;
    }
    this.root.classList.remove('hidden');
    this.hideTimer = window.setTimeout(() => this.hide(), TOAST_MS);
    return shownToken;
  }

  setKillCount(shownToken: number, kills: number): void {
    if (shownToken !== this.token) {
      // A newer death has already replaced this toast — don't resurrect it.
      return;
    }
    this.killsEl.textContent = `This trap has ${kills} kill${kills === 1 ? '' : 's'}.`;
  }

  hide(): void {
    this.token++;
    window.clearTimeout(this.hideTimer);
    this.root.classList.add('hidden');
  }
}
