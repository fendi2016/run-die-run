import type { ObjectType } from '../../shared/types';
import { requireButton, requireElement } from './domUtils';

const TYPE_LABELS: Partial<Record<ObjectType, string>> = {
  spike: 'Spike',
  saw: 'Saw',
  movingSaw: 'Moving Saw',
  fallingBlock: 'Falling Block',
};

function labelFor(type: ObjectType): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

// DOM-based death screen, shown on every death instead of the old
// auto-restart timer — the run only resumes once the player taps Retry.
// Attribution ("Killed by u/X's Saw — this trap has N kills") shows above
// the buttons when a hazard is to blame; a Follow-the-subreddit button
// sits alongside Retry, available every death but only asks once —
// `markFollowed()` sticks for the rest of this panel's lifetime (one
// instance per GameScene, same as RunResultOverlay/TapToStartPrompt).
export class DeathPanel {
  private readonly root = requireElement('death-panel');
  private readonly attributionEl = requireElement('death-panel-attribution');
  private readonly killsEl = requireElement('death-panel-kills');
  private readonly retryBtn = requireButton('death-panel-retry-btn');
  private readonly followBtn = requireButton('death-panel-follow-btn');
  private token = 0;
  private followed = false;

  // `addedBy`/`type` absent for a fall-death or a seed-level trap — no
  // attribution to show, but Retry/Follow still need to appear. Returns a
  // token for gating a later `setKillCount` against a newer death.
  show(subredditName: string, addedBy?: string, type?: ObjectType): number {
    const shownToken = ++this.token;
    if (addedBy && type) {
      this.attributionEl.textContent = `Killed by u/${addedBy}'s ${labelFor(type)}`;
      this.attributionEl.classList.remove('hidden');
    } else {
      this.attributionEl.textContent = '';
      this.attributionEl.classList.add('hidden');
    }
    this.killsEl.textContent = '';
    if (!this.followed) {
      this.followBtn.textContent = `Follow r/${subredditName}`;
    }
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

  setFollowHandler(handler: () => void): void {
    this.followBtn.onclick = handler;
  }

  markFollowed(): void {
    this.followed = true;
    this.followBtn.disabled = true;
    this.followBtn.textContent = 'Following ✓';
    this.followBtn.onclick = null;
  }

  hide(): void {
    this.token++;
    this.root.classList.add('hidden');
  }
}
