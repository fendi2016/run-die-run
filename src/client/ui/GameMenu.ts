import { DEFAULT_LEVEL_ID } from '../../shared/constants';
import { isCurrencyBalanceResponse } from '../../shared/currencyApi';
import { isLevelStats } from '../../shared/discoveryApi';
import { requireButton, requireElement } from './domUtils';
import { initFollowButton } from './followButton';
import { LeaderboardOverlay } from './LeaderboardOverlay';

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
  private readonly currencyValueEl = requireElement('game-menu-currency-value');

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
      LeaderboardOverlay.instance().show()
    );
    initFollowButton(requireButton('game-menu-follow-btn'));
  }

  setHandlers(handlers: GameMenuHandlers): void {
    this.handlers = handlers;
  }

  show(): void {
    this.root.classList.remove('hidden');
    void this.refreshStats();
    void this.refreshCurrency();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  // Mirrors splash.ts's loadStats: real stats for the one level this build
  // actually points new players at, fetched after the menu is already up
  // so a slow/failed request never blocks Play/Build/Browse.
  private async refreshStats(): Promise<void> {
    try {
      const response = await fetch(`/api/discovery/stats/${encodeURIComponent(DEFAULT_LEVEL_ID)}`, { signal: AbortSignal.timeout(8000) });
      const body: unknown = await response.json();
      if (!response.ok || !isLevelStats(body)) {
        return;
      }

      this.statValueEl.textContent = body.attempts.toLocaleString();
      this.creatorNameEl.textContent = `u/${body.creatorUsername}`;
    } catch {
      // Leave the placeholder dashes — the menu already works either way.
    }
  }

  private async refreshCurrency(): Promise<void> {
    try {
      const response = await fetch('/api/currency');
      const body: unknown = await response.json();
      if (!response.ok || !isCurrencyBalanceResponse(body)) {
        return;
      }
      this.currencyValueEl.textContent = body.balance.toLocaleString();
    } catch {
      // Leave the placeholder dash — the menu already works either way.
    }
  }
}
