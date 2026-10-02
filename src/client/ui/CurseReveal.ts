import {
  isMyCursesResponse,
  pickCurseReveal,
  type CurseReveal,
} from '../../shared/myCursesApi';
import { labelFor } from '../../shared/objectLabels';
import { withTimeout } from '../net';
import { requireButton, requireElement } from './domUtils';

// "While you were away…": when other players got caught by your traps
// since you last looked, the game opens on that news with a way straight
// to the trap. The player's curses are fetched while the Preloader's bar
// fills, and the reveal only shows if they're already back when the menu
// decides — it never holds up Play. Shown at most once per page session.

let revealData: CurseReveal | undefined;
let revealShown = false;

export function prefetchCurseReveal(): void {
  fetch('/api/me/curses', { signal: withTimeout(new AbortController().signal, 15000) })
    .then(async (response) => {
      const body: unknown = await response.json();
      if (response.ok && isMyCursesResponse(body)) revealData = pickCurseReveal(body.curses);
    })
    .catch(() => undefined);
}

// The reveal to show now, if there is one and it hasn't been shown yet.
export function takeCurseReveal(): CurseReveal | undefined {
  if (revealShown || !revealData) return undefined;
  revealShown = true;
  return revealData;
}

export type CurseRevealHandlers = {
  onSeeIt: () => void;
  onDismiss: () => void;
  dismissLabel: string;
};

export class CurseRevealPanel {
  private static singleton: CurseRevealPanel | undefined;

  static instance(): CurseRevealPanel {
    return (CurseRevealPanel.singleton ??= new CurseRevealPanel());
  }

  private readonly root = requireElement('curse-reveal');
  private readonly lineEl = requireElement('curse-reveal-line');
  private readonly levelEl = requireElement('curse-reveal-level');
  private readonly othersEl = requireElement('curse-reveal-others');
  private readonly seeBtn = requireButton('curse-reveal-see');
  private readonly dismissBtn = requireButton('curse-reveal-dismiss');

  show({ curse, otherNewCaught }: CurseReveal, handlers: CurseRevealHandlers): void {
    const players = curse.newCaught === 1 ? 'player' : 'players';
    this.lineEl.textContent = `Your ${labelFor(curse.type)} caught ${curse.newCaught} more ${players} 💀`;
    this.levelEl.textContent = `on ${curse.levelTitle}`;
    this.othersEl.textContent =
      otherNewCaught > 0 ? `Your other traps caught ${otherNewCaught} more.` : '';
    this.othersEl.classList.toggle('hidden', otherNewCaught === 0);
    this.dismissBtn.textContent = handlers.dismissLabel;
    this.seeBtn.onclick = () => {
      this.hide();
      handlers.onSeeIt();
    };
    this.dismissBtn.onclick = () => {
      this.hide();
      handlers.onDismiss();
    };
    this.root.classList.remove('hidden');
    // Told now, so the STATS badge doesn't count these again.
    void fetch('/api/me/curses/seen', { method: 'POST' }).catch(() => undefined);
  }

  hide(): void {
    this.seeBtn.onclick = null;
    this.dismissBtn.onclick = null;
    this.root.classList.add('hidden');
  }
}
