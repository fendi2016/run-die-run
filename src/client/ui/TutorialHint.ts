import { requireElement } from './domUtils';

// The tutorial's one-line prompt, over the level. Non-interactive, so taps
// still reach the canvas as jumps. `set` is called every frame and only
// touches the DOM when the text actually changes.
export class TutorialHint {
  private readonly root = requireElement('tutorial-hint');
  private current = '';

  set(text: string): void {
    if (text === this.current) return;
    this.current = text;
    this.root.textContent = text;
    this.root.classList.toggle('hidden', text === '');
  }

  hide(): void {
    this.set('');
  }
}
