import { isUserStatsResponse, type UserStatsResponse } from '../../shared/userStatsApi';
import { requireButton, requireElement } from './domUtils';

// DOM overlay for a personal "your stats" snapshot — currency, clear
// streak, total clears, levels created, and curse kills, each already
// tracked server-side (see userStats.ts) but never surfaced in one place
// before. Opened by tapping the SHARDS chip in GameMenu. Singleton, same
// pattern as LeaderboardOverlay/DiscoveryOverlay.
export class StatsOverlay {
  private static singleton: StatsOverlay | undefined;

  static instance(): StatsOverlay {
    return (StatsOverlay.singleton ??= new StatsOverlay());
  }

  private readonly root = requireElement('stats-overlay');
  private readonly messageEl = requireElement('stats-message');
  private readonly listEl = requireElement('stats-list');
  private readonly closeBtn = requireButton('stats-close');
  private readonly currencyEl = requireElement('stats-currency');
  private readonly streakEl = requireElement('stats-streak');
  private readonly totalClearsEl = requireElement('stats-total-clears');
  private readonly levelsCreatedEl = requireElement('stats-levels-created');
  private readonly contributionKillsEl = requireElement('stats-contribution-kills');
  // Guards against a slow response landing after the panel was reopened
  // (or closed) from overwriting the numbers with stale data.
  private requestToken = 0;

  private constructor() {
    this.closeBtn.onclick = () => this.hide();
  }

  show(): void {
    this.root.classList.remove('hidden');
    void this.load();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private async load(): Promise<void> {
    const token = ++this.requestToken;
    this.showMessage('Loading…');
    try {
      const response = await fetch('/api/stats/me');
      const body: unknown = await response.json();
      if (token !== this.requestToken) return;
      if (response.status === 401) {
        this.showMessage('Sign in to Reddit to see your stats.');
        return;
      }
      if (!response.ok || !isUserStatsResponse(body)) {
        this.showMessage('Could not load stats.');
        return;
      }
      this.render(body);
    } catch {
      if (token === this.requestToken) {
        this.showMessage('Could not load stats.');
      }
    }
  }

  private showMessage(message: string): void {
    this.messageEl.textContent = message;
    this.messageEl.classList.remove('hidden');
    this.listEl.classList.add('hidden');
  }

  private render(stats: UserStatsResponse): void {
    this.messageEl.classList.add('hidden');
    this.listEl.classList.remove('hidden');
    this.currencyEl.textContent = stats.currencyBalance.toLocaleString();
    this.streakEl.textContent = stats.clearStreak.toLocaleString();
    this.totalClearsEl.textContent = stats.totalClears.toLocaleString();
    this.levelsCreatedEl.textContent = stats.levelsCreated.toLocaleString();
    this.contributionKillsEl.textContent = stats.contributionKills.toLocaleString();
  }
}
