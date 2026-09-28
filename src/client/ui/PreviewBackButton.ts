import { requireButton, requireElement } from './domUtils';

// Shown only while GameScene is running a preview/"Test" session launched
// from the editor (spec sections 12-13), so the creator can bail out back
// to editing without having to die or finish first. Singleton for the same
// reason as EditorToolbar: GameScene's create() re-runs on every restart
// (each Test click relaunches GameScene fresh), but this DOM button is
// static markup that outlives any one scene instance.
export class PreviewBackButton {
  private static singleton: PreviewBackButton | undefined;

  static instance(): PreviewBackButton {
    return (PreviewBackButton.singleton ??= new PreviewBackButton());
  }

  private handler: (() => void) | undefined;
  private readonly root = requireElement('editor-preview-back');
  private readonly button = requireButton('editor-preview-back-btn');

  private constructor() {
    this.button.addEventListener('click', () => {
      this.handler?.();
    });
  }

  // Every caller sets its own label — the button is shared between the
  // editor/curse previews ("← Back to Editor") and the tutorial ("Skip").
  setLabel(text: string): void {
    this.button.textContent = text;
  }

  setOnBack(handler: () => void): void {
    this.handler = handler;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
