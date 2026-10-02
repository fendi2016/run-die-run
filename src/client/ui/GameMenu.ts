import { isMyCursesResponse } from '../../shared/myCursesApi';
import { SEED_AUTHOR } from '../../shared/constants';
import { getRequestedLevelId } from '../game/levelSelection';
import { isLevelStats } from '../../shared/discoveryApi';
import { deadliestTrapText } from '../../shared/levelStatsText';
import { showKillLine } from './killLine';
import { requireButton, requireElement } from './domUtils';
import { initFollowButton } from './followButton';
import { LeaderboardOverlay } from './LeaderboardOverlay';
import { StatsOverlay } from './StatsOverlay';

export type GameMenuHandlers = {
  onPlay: () => void;
  onBuild: () => void;
  onBrowse: () => void;
};

// DOM-based menu overlay for game.html (the popped-out/expanded webview),
// styled to match splash.html's card so Exit/Cancel from the editor and
// curse flows land on the same design instead of the old bare Phaser
// placeholder — same DOM-overlay-over-canvas singleton pattern as
// CurseToolbar/EditorToolbar.
export class GameMenu {
  private static singleton: GameMenu | undefined;

  static instance(): GameMenu {
    return (GameMenu.singleton ??= new GameMenu());
  }

  private handlers: GameMenuHandlers | undefined;

  private readonly root = requireElement('game-menu');
  private readonly statValueEl = requireElement('game-menu-stat-value');
  private readonly creatorNameEl = requireElement('game-menu-creator-name');
  private readonly statsBadgeEl = requireElement('game-menu-stats-badge');

  private constructor() {
    requireButton('game-menu-play').addEventListener('click', () =>
      this.handlers?.onPlay()
    );
    requireButton('game-menu-build').addEventListener('click', () =>
      this.handlers?.onBuild()
    );
    requireButton('game-menu-browse').addEventListener('click', () =>
      this.handlers?.onBrowse()
    );
    requireButton('game-menu-leaderboard').addEventListener('click', () =>
      this.openLeaderboard()
    );
    requireButton('game-menu-stats-chip').addEventListener('click', () => this.openStats());
    initFollowButton(requireButton('game-menu-follow-btn'));
  }

  openLeaderboard(): void {
    LeaderboardOverlay.instance().show();
  }

  openStats(): void {
    StatsOverlay.instance().show(() => this.statsBadgeEl.classList.add('hidden'));
  }

  setHandlers(handlers: GameMenuHandlers): void {
    this.handlers = handlers;
  }

  show(): void {
    this.root.classList.remove('hidden');
    void this.refreshStats();
    void this.refreshCurseBadge();
  }

  // "N new" on the STATS chip when other players have hit (or got past)
  // this player's curses since they last opened their stats.
  private async refreshCurseBadge(): Promise<void> {
    try {
      const response = await fetch('/api/me/curses', { signal: AbortSignal.timeout(8000) });
      const body: unknown = await response.json();
      if (!response.ok || !isMyCursesResponse(body)) return;
      const fresh = body.curses.reduce((sum, c) => sum + c.newCaught + c.newPassed, 0);
      this.statsBadgeEl.textContent = `${fresh} new`;
      this.statsBadgeEl.classList.toggle('hidden', fresh === 0);
    } catch {
      // No badge; the menu works either way.
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  // Mirrors splash.ts's loadStats: real stats for the level this post
  // plays, fetched after the menu is already up
  // so a slow/failed request never blocks Play/Build/Browse.
  private async refreshStats(): Promise<void> {
    try {
      const response = await fetch(`/api/discovery/stats/${encodeURIComponent(getRequestedLevelId())}`, { signal: AbortSignal.timeout(8000) });
      const body: unknown = await response.json();
      if (!response.ok || !isLevelStats(body)) {
        return;
      }

      this.statValueEl.textContent = body.attempts.toLocaleString();
      showKillLine(deadliestTrapText(body));
      this.creatorNameEl.textContent =
        body.creatorUsername === SEED_AUTHOR ? 'SKETCHY' : `u/${body.creatorUsername}`;
    } catch {
      // Leave the placeholder dashes — the menu already works either way.
    }
  }
}
