import { isCursersLeaderboardResponse } from '../../shared/leaderboardApi';
import { requireButton, requireElement } from './domUtils';

export type LeaderboardOverlayOptions = {
  // Scopes the board to one level's contributor kills (levelContributorKillsKey)
  // instead of the global cross-level one — shown from GameScene's result
  // overlay, where "Leaderboard" means "for the level I just played," not
  // the whole game.
  levelId?: string;
};

// DOM overlay for the "TOP CURSERS" board (spec section 24) — ranked by
// trap kills, not time (this game is an auto-runner; pace is set by the
// side-scroll, not player input speed, so clear time isn't a meaningful
// competitive axis here). Global by default (reachable from MainMenu), or
// scoped to one level when opened with a levelId (GameScene's result
// overlay). A singleton like GameMenu/PreviewBackButton, not a
// per-GameScene instance.
export class LeaderboardOverlay {
  private static singleton: LeaderboardOverlay | undefined;

  static instance(): LeaderboardOverlay {
    return (LeaderboardOverlay.singleton ??= new LeaderboardOverlay());
  }

  private readonly root = requireElement('leaderboard-overlay');
  private readonly titleEl = requireElement('leaderboard-title');
  private readonly bodyEl = requireElement('leaderboard-body');
  private readonly closeBtn = requireButton('leaderboard-close');
  // Guards against a slow response landing after the panel was reopened
  // (or closed) from overwriting the table with stale data.
  private requestToken = 0;

  private constructor() {
    this.closeBtn.onclick = () => this.hide();
  }

  show(options: LeaderboardOverlayOptions = {}): void {
    this.root.classList.remove('hidden');
    this.titleEl.textContent = options.levelId
      ? 'TOP CURSERS — THIS LEVEL'
      : 'TOP CURSERS';
    void this.load(options.levelId);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private async load(levelId: string | undefined): Promise<void> {
    const token = ++this.requestToken;
    this.renderMessage('Loading…');
    try {
      const url = levelId
        ? `/api/leaderboard/level/${encodeURIComponent(levelId)}`
        : '/api/leaderboard';
      const response = await fetch(url);
      const body: unknown = await response.json();
      if (token !== this.requestToken) return;
      if (!response.ok || !isCursersLeaderboardResponse(body)) {
        this.renderMessage('Could not load leaderboard.');
        return;
      }
      this.renderRows(body.topTen);
    } catch {
      if (token === this.requestToken) {
        this.renderMessage('Could not load leaderboard.');
      }
    }
  }

  private renderMessage(message: string): void {
    this.bodyEl.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = message;
    row.appendChild(cell);
    this.bodyEl.appendChild(row);
  }

  private renderRows(entries: { username: string; kills: number }[]): void {
    if (entries.length === 0) {
      this.renderMessage('No curse kills yet.');
      return;
    }
    this.bodyEl.replaceChildren();
    for (const [i, entry] of entries.entries()) {
      const row = document.createElement('tr');
      for (const text of [String(i + 1), `u/${entry.username}`, String(entry.kills)]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      this.bodyEl.appendChild(row);
    }
  }
}
