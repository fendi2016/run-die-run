import { requireButton, requireElement } from './domUtils';

type Handlers = {
  pause: () => void;
  resume: () => void;
  restart: () => void;
  retryLoad: () => void;
  menu: () => void;
  browse: () => void;
};

// DOM controls stay interactive while Phaser's gameplay scene is paused.
export class GameplayControls {
  private readonly toggle = requireButton('gameplay-menu');
  private readonly dialog = requireElement('gameplay-dialog');
  private readonly title = requireElement('gameplay-dialog-title');
  private readonly message = requireElement('gameplay-dialog-message');
  private readonly resume = requireButton('gameplay-resume');
  private readonly restart = requireButton('gameplay-restart');
  private readonly retry = requireButton('gameplay-retry-load');
  private readonly buttons: HTMLButtonElement[];

  constructor(handlers: Handlers, preview: boolean) {
    const actions: [string, () => void][] = [
      ['gameplay-menu', handlers.pause],
      ['gameplay-resume', handlers.resume],
      ['gameplay-retry-load', handlers.retryLoad],
      ['gameplay-restart', handlers.restart],
      ['gameplay-browse', handlers.browse],
      ['gameplay-exit', handlers.menu],
      ['death-panel-browse', handlers.browse],
      ['death-panel-menu', handlers.menu],
      ['run-result-browse', handlers.browse],
      ['run-result-menu', handlers.menu],
    ];
    this.buttons = actions.map(([id, action]) => {
      const button = requireButton(id);
      button.onclick = action;
      return button;
    });
    for (const id of ['death-panel-browse', 'run-result-browse', 'gameplay-browse']) {
      requireButton(id).classList.toggle('hidden', preview);
    }
    this.dialog.onkeydown = (event) => {
      if (event.key !== 'Tab') return;
      const visible = this.buttons.filter((button) => this.dialog.contains(button) && !button.classList.contains('hidden'));
      const first = visible[0];
      const last = visible.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    this.toggle.classList.remove('hidden');
  }

  // While a level fetch is in flight there's nothing to pause yet; the
  // Pause / Menu button comes back with hideDialog() once the run starts.
  hideWhileLoading(): void {
    this.dialog.classList.add('hidden');
    this.toggle.classList.add('hidden');
  }

  showLoadError(): void {
    this.show('Could not load this level', 'Check your connection and try again, or choose another level.', false, false, true, true);
    this.retry.focus({ preventScroll: true });
  }

  showPaused(ended: boolean): void {
    this.show(ended ? 'Menu' : 'Paused', ended ? 'Choose what to do next.' : '', true, true, false, false);
    this.resume.textContent = ended ? 'Back' : 'Resume';
    this.resume.focus({ preventScroll: true });
  }

  // `emptyCanvas` distinguishes "nothing behind this dialog yet" (loading/
  // load-error, before any level art exists) from "paused mid-run" (the
  // level is visible and dimmed behind it) — the two need opposite panel
  // treatments. Without this, loading/error reused the paused look (no
  // card, relies on the level art behind it for contrast) and rendered as
  // bare green title text and near-invisible ghost buttons floating on an
  // empty canvas: a jarring, unstyled-looking screen wedged between the
  // Preloader's loading bar and the level actually appearing.
  private show(title: string, message: string, resume: boolean, restart: boolean, retry: boolean, emptyCanvas: boolean): void {
    this.title.textContent = title;
    this.message.textContent = message;
    this.resume.classList.toggle('hidden', !resume);
    this.restart.classList.toggle('hidden', !restart);
    this.retry.classList.toggle('hidden', !retry);
    this.toggle.classList.add('hidden');
    this.dialog.classList.toggle('gameplay-dialog-loading', emptyCanvas);
    for (const id of ['death-panel', 'run-result', 'editor-preview-back']) requireElement(id).inert = true;
    this.dialog.classList.remove('hidden');
  }

  hideDialog(): void {
    this.dialog.classList.add('hidden');
    for (const id of ['death-panel', 'run-result', 'editor-preview-back']) requireElement(id).inert = false;
    this.toggle.classList.remove('hidden');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  destroy(): void {
    this.toggle.classList.add('hidden');
    this.dialog.classList.add('hidden');
    for (const id of ['death-panel', 'run-result', 'editor-preview-back']) requireElement(id).inert = false;
    for (const button of this.buttons) button.onclick = null;
    this.dialog.onkeydown = null;
  }
}
