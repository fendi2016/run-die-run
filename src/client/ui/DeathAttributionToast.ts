import type { ObjectType } from '../../shared/types';
import { requireElement } from './domUtils';

const TOAST_VISIBLE_MS = 2500;

const TYPE_LABELS: Partial<Record<ObjectType, string>> = {
  spike: 'Spike',
  saw: 'Saw',
  movingSaw: 'Moving Saw',
  fallingBlock: 'Falling Block',
};

function labelFor(type: ObjectType): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

// "Killed by u/X's Saw — this trap has N kills" (spec section 23). Shown as
// an unobtrusive toast independent of the death/restart timer (spec
// section 30: the respawn itself must never wait on a network call) — the
// attribution line appears instantly from data the client already has, the
// kill count fills in a moment later once the fire-and-forget
// `/api/runs/trap-kill` report resolves. A fresh death always replaces
// whatever toast is currently showing rather than queuing.
export class DeathAttributionToast {
  private readonly root = requireElement('death-toast');
  private readonly attributionEl = requireElement('death-toast-attribution');
  private readonly killsEl = requireElement('death-toast-kills');
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;

  showAttribution(addedBy: string, type: ObjectType): number {
    const shownToken = ++this.token;
    this.attributionEl.textContent = `Killed by u/${addedBy}'s ${labelFor(type)}`;
    this.killsEl.textContent = '';
    this.root.classList.remove('hidden');
    this.restartHideTimer();
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
    this.root.classList.add('hidden');
    clearTimeout(this.hideTimer);
  }

  private restartHideTimer(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(
      () => this.root.classList.add('hidden'),
      TOAST_VISIBLE_MS
    );
  }
}
