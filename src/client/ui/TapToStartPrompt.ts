import { requireElement } from './domUtils';

// Shown at spawn until the player's first jump input (spec: a level
// shouldn't just start moving under the player the instant it loads).
// Exactly one line of instruction lives here — GameScene passes the text
// (the tutorial's first hint, or the generic control line for a normal
// run) so this never competes with TutorialHint, which only starts
// driving its own text once the run actually begins (see GameScene.update()).
// GameScene owns a fresh instance per create(), same as RunResultOverlay —
// not a singleton, since there's no cross-restart state to preserve.
export class TapToStartPrompt {
  private readonly root = requireElement('tap-to-start');
  private readonly label = requireElement('tap-to-start-label');

  show(text: string): void {
    this.label.textContent = text;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
