import {
  isDiscoveryResponse,
  isDiscoverySort,
  type DiscoverySort,
  type LevelSummary,
} from '../../shared/discoveryApi';
import { withTimeout } from '../net';
import { requireButton, requireElement } from './domUtils';

const SORTS: DiscoverySort[] = ['trending', 'deadliest', 'speedrun', 'new'];

export type DiscoveryOverlayHandlers = {
  onSelectLevel: (levelId: string) => void;
};

// DOM-based level browser (spec sections 26-27), shown over GameMenu the
// same way LeaderboardOverlay is — a singleton like GameMenu/
// LeaderboardOverlay. Replaces an earlier version drawn straight onto the
// Phaser canvas with rexUI's GridTable, which looked and scrolled nothing
// like the rest of this app's DOM UI; a plain scrollable div gives native
// scrolling for free, so that dependency is gone entirely.
export class DiscoveryOverlay {
  private static singleton: DiscoveryOverlay | undefined;

  static instance(): DiscoveryOverlay {
    return (DiscoveryOverlay.singleton ??= new DiscoveryOverlay());
  }

  private handlers: DiscoveryOverlayHandlers | undefined;
  private sort: DiscoverySort = 'trending';
  private request: AbortController | undefined;
  // Guards against a slow response landing after the sort changed (or the
  // overlay was reopened) from overwriting the list with stale data.
  private requestToken = 0;

  private readonly root = requireElement('discovery-overlay');
  private readonly messageEl = requireElement('discovery-message');
  private readonly listEl = requireElement('discovery-list');
  private readonly sortButtons: HTMLButtonElement[];

  private constructor() {
    requireButton('discovery-back').onclick = () => this.hide();
    requireButton('discovery-retry').onclick = () => void this.load();
    this.sortButtons = SORTS.map((sort) => {
      const button = requireButton(`discovery-sort-${sort}`);
      button.onclick = () => {
        if (this.sort === sort) return;
        this.sort = sort;
        this.updateSortButtons();
        void this.load();
      };
      return button;
    });
  }

  show(handlers: DiscoveryOverlayHandlers): void {
    this.handlers = handlers;
    this.sort = 'trending';
    this.updateSortButtons();
    this.root.classList.remove('hidden');
    void this.load();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.request?.abort();
    this.request = undefined;
  }

  private updateSortButtons(): void {
    for (const button of this.sortButtons) {
      const sort = button.dataset.sort;
      button.classList.toggle('active', isDiscoverySort(sort) && sort === this.sort);
    }
  }

  private async load(): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const token = ++this.requestToken;
    this.messageEl.textContent = 'Loading levels…';
    this.listEl.replaceChildren();
    try {
      const response = await fetch(`/api/discovery/levels?sort=${this.sort}`, {
        signal: withTimeout(request.signal, 15000),
      });
      const body: unknown = await response.json();
      if (token !== this.requestToken) return;
      if (!response.ok || !isDiscoveryResponse(body)) {
        throw new Error('Invalid discovery response');
      }
      this.renderLevels(body.levels);
    } catch {
      if (token !== this.requestToken) return;
      this.messageEl.textContent = 'Could not load levels. Tap Retry.';
    }
  }

  private renderLevels(levels: LevelSummary[]): void {
    this.messageEl.textContent = levels.length === 0 ? 'No published levels yet.' : '';
    this.listEl.replaceChildren(...levels.map((level) => this.buildCard(level)));
  }

  private buildCard(level: LevelSummary): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'discovery-card';
    card.onclick = () => this.handlers?.onSelectLevel(level.levelId);

    const title = document.createElement('div');
    title.className = 'discovery-card-title';
    title.textContent = level.title;
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'discovery-card-meta';
    meta.textContent = `by u/${level.creatorUsername} · v${level.version}`;
    card.appendChild(meta);

    const stats = document.createElement('div');
    stats.className = 'discovery-card-stats';
    const completion =
      level.attempts === 0 ? '—' : `${(level.completionRate * 100).toFixed(1)}%`;
    const record =
      level.worldRecordMs === null ? '—' : `${(level.worldRecordMs / 1000).toFixed(3)}s`;
    for (const text of [
      level.difficulty,
      `Completion: ${completion}`,
      `Attempts: ${level.attempts}`,
      `Clears: ${level.clears}`,
      `Record: ${record}`,
    ]) {
      const span = document.createElement('span');
      span.textContent = text;
      stats.appendChild(span);
    }
    card.appendChild(stats);

    return card;
  }
}
