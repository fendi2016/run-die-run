import type { SubmitRunResponse } from '../../shared/runsApi';

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} element`);
  }
  return el;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

// DOM-based (not Phaser) result screen shown after clearing a run (spec
// section 8). Lives outside the canvas so it renders crisp text without
// fighting the game camera's zoom, and so it can grow into the curse-flow
// UI (spec section 14) without needing a Phaser scene of its own.
export class RunResultOverlay {
  private readonly root = requireElement('run-result');
  private readonly timeEl = requireElement('run-result-time');
  private readonly rankEl = requireElement('run-result-rank');
  private readonly pbEl = requireElement('run-result-pb');
  private readonly wrEl = requireElement('run-result-wr');

  // Shown immediately on finish, before the server round-trip resolves, so
  // the player sees their time instantly rather than waiting on network.
  showTime(timeMs: number): void {
    this.timeEl.textContent = formatSeconds(timeMs);
    this.rankEl.textContent = '';
    this.pbEl.textContent = '';
    this.wrEl.textContent = '';
    this.root.classList.remove('hidden');
  }

  showResult(result: SubmitRunResponse): void {
    this.rankEl.textContent = `#${result.rank} on this version`;
    this.pbEl.textContent = `Personal Best: ${formatSeconds(result.personalBestMs)}`;
    this.wrEl.textContent = `World Record: ${formatSeconds(result.worldRecordMs)}`;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
