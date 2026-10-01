import { isMyCursesResponse, type MyCurse } from '../../shared/myCursesApi';
import { labelFor } from '../../shared/objectLabels';
import { isUserStatsResponse, type UserStatsResponse } from '../../shared/userStatsApi';
import { requireButton, requireElement } from './domUtils';

// DOM overlay for a personal "your stats" snapshot — clear streak, total
// clears, levels created, and curse kills, each already tracked
// server-side (see userStats.ts) but never surfaced in one place before.
// Opened by tapping the stats chip in GameMenu. Singleton, same pattern as
// LeaderboardOverlay/DiscoveryOverlay.
export class StatsOverlay {
  private static singleton: StatsOverlay | undefined;

  static instance(): StatsOverlay {
    return (StatsOverlay.singleton ??= new StatsOverlay());
  }

  private readonly root = requireElement('stats-overlay');
  private readonly messageEl = requireElement('stats-message');
  private readonly listEl = requireElement('stats-list');
  private readonly closeBtn = requireButton('stats-close');
  private readonly streakEl = requireElement('stats-streak');
  private readonly totalClearsEl = requireElement('stats-total-clears');
  private readonly levelsCreatedEl = requireElement('stats-levels-created');
  private readonly contributionKillsEl = requireElement('stats-contribution-kills');
  private readonly cursesEl = requireElement('stats-curses');
  // Runs on close (GameMenu clears the STATS badge).
  private onHide: (() => void) | undefined;
  // Guards against a slow response landing after the panel was reopened
  // (or closed) from overwriting the numbers with stale data.
  private requestToken = 0;

  private constructor() {
    this.closeBtn.onclick = () => this.hide();
  }

  show(onHide?: () => void): void {
    this.onHide = onHide;
    this.root.classList.remove('hidden');
    void this.load();
    void this.loadCurses();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.onHide?.();
    this.onHide = undefined;
  }

  // Each curse's catches and survivors, then marks them seen so the STATS
  // badge only counts what's new next time.
  private async loadCurses(): Promise<void> {
    const token = this.requestToken;
    this.cursesEl.replaceChildren();
    try {
      const response = await fetch('/api/me/curses');
      const body: unknown = await response.json();
      if (token !== this.requestToken || !response.ok || !isMyCursesResponse(body)) return;
      if (body.curses.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'No sabotage yet — beat a level and booby-trap it.';
        this.cursesEl.replaceChildren(empty);
        return;
      }
      this.cursesEl.replaceChildren(...body.curses.slice(0, 10).map(curseRow));
      void fetch('/api/me/curses/seen', { method: 'POST' }).catch(() => undefined);
    } catch {
      // The rest of the stats still show.
    }
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
    this.streakEl.textContent = stats.clearStreak.toLocaleString();
    this.totalClearsEl.textContent = stats.totalClears.toLocaleString();
    this.levelsCreatedEl.textContent = stats.levelsCreated.toLocaleString();
    this.contributionKillsEl.textContent = stats.contributionKills.toLocaleString();
  }
}

export function curseFeedbackLine(curse: MyCurse): string {
  const players = curse.caught === 1 ? 'player' : 'players';
  return `Your ${labelFor(curse.type)} caught ${curse.caught} ${players}. ${curse.passed} made it through.`;
}

function curseRow(curse: MyCurse): HTMLLIElement {
  const row = document.createElement('li');
  const line = document.createElement('div');
  line.textContent = curseFeedbackLine(curse);
  if (curse.newCaught > 0 || curse.newPassed > 0) {
    const fresh = document.createElement('span');
    fresh.className = 'stats-curse-new';
    fresh.textContent = `+${curse.newCaught} caught · +${curse.newPassed} through`;
    line.append(fresh);
  }
  const level = document.createElement('div');
  level.className = 'stats-curse-level';
  level.textContent = `on ${curse.levelTitle}`;
  row.append(line, level);
  return row;
}
