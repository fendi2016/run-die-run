import { requireElement } from './domUtils';

// Shown at spawn until the player's first jump input (spec: a level
// shouldn't just start moving under the player the instant it loads).
// GameScene owns a fresh instance per create(), same as RunResultOverlay —
// not a singleton, since there's no cross-restart state to preserve.
export class TapToStartPrompt {
  private readonly root = requireElement('tap-to-start');

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
