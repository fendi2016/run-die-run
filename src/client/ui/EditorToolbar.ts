import { showToast } from '@devvit/web/client';
import { parseDraftObjectsJson, type DraftObject } from '../../shared/editorApi';
import { PLACEABLE_TYPES, type EditorTool } from '../game/editor/GridSystem';
import {
  requireButton,
  requireElement,
  requireInput,
  requireTextArea,
} from './domUtils';

const TOOL_IDS: EditorTool[] = ['select', 'erase', ...PLACEABLE_TYPES];

export type EditorToolbarHandlers = {
  onToolSelected: (tool: EditorTool) => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSave: () => void;
  onPublishRequested: () => void;
  onPublishConfirm: (title: string) => void;
  onPublishCancel: () => void;
  onJsonRequested: () => void;
  onJsonLoad: (objects: DraftObject[]) => void;
  onSeedLevelOpen: (levelId: string) => void;
  onExit: () => void;
};

// DOM-based bottom toolbar (spec section 12: "bottom toolbar on mobile"),
// following the same DOM-overlay-over-Phaser-canvas pattern as
// RunResultOverlay. A module-level singleton because EditorScene's
// create() re-runs every time the scene restarts (returning from a Test
// run relaunches EditorScene fresh), but these DOM elements are static
// markup that outlives any one scene instance — rebinding fresh listeners
// on every create() would stack duplicate handlers on the same buttons.
// `setHandlers` swaps the active callbacks; the DOM listeners themselves
// are bound exactly once, in the constructor.
export class EditorToolbar {
  private static singleton: EditorToolbar | undefined;

  static instance(): EditorToolbar {
    return (EditorToolbar.singleton ??= new EditorToolbar());
  }

  private handlers: EditorToolbarHandlers | undefined;

  private readonly root = requireElement('editor-ui');
  private readonly messageEl = requireElement('editor-message');
  private readonly undoBtn = requireButton('editor-undo');
  private readonly redoBtn = requireButton('editor-redo');
  private readonly deleteBtn = requireButton('editor-delete');
  private readonly publishBtn = requireButton('editor-publish');
  private readonly publishDialog = requireElement('editor-publish-dialog');
  private readonly titleInput = requireInput('editor-title-input');
  private readonly moreDialog = requireElement('editor-more-dialog');
  private readonly jsonDialog = requireElement('editor-json-dialog');
  private readonly jsonTextArea = requireTextArea('editor-json-textarea');
  private readonly jsonErrorEl = requireElement('editor-json-error');
  private readonly copyCodeBtn = requireButton('editor-json-copy-code');
  private readonly seedLevelsEl = requireElement('editor-seed-levels');
  private readonly seedLevelListEl = requireElement('editor-seed-level-list');
  // seedLevels.ts code for the built-in level being edited, if any.
  private seedCode: string | undefined;
  private readonly toolButtons = new Map<EditorTool, HTMLButtonElement>();

  private constructor() {
    for (const tool of TOOL_IDS) {
      const button = requireButton(`editor-tool-${tool}`);
      this.toolButtons.set(tool, button);
      button.addEventListener('click', () => {
        this.setActiveTool(tool);
        this.handlers?.onToolSelected(tool);
      });
    }
    this.setActiveTool('select');

    requireButton('editor-pan-left').addEventListener('click', () =>
      this.handlers?.onPanLeft()
    );
    requireButton('editor-pan-right').addEventListener('click', () =>
      this.handlers?.onPanRight()
    );
    this.undoBtn.addEventListener('click', () => this.handlers?.onUndo());
    this.redoBtn.addEventListener('click', () => this.handlers?.onRedo());
    this.deleteBtn.addEventListener('click', () => this.handlers?.onDelete());
    requireButton('editor-test').addEventListener('click', () =>
      this.handlers?.onTest()
    );
    requireButton('editor-save').addEventListener('click', () =>
      this.handlers?.onSave()
    );
    this.publishBtn.addEventListener('click', () =>
      this.handlers?.onPublishRequested()
    );
    requireButton('editor-exit').addEventListener('click', () =>
      this.handlers?.onExit()
    );
    requireButton('editor-publish-confirm').addEventListener('click', () => {
      this.handlers?.onPublishConfirm(this.titleInput.value.trim());
    });
    requireButton('editor-publish-cancel').addEventListener('click', () => {
      this.handlers?.onPublishCancel();
    });
    requireButton('editor-more').addEventListener('click', () =>
      this.showMoreMenu()
    );
    requireButton('editor-more-close').addEventListener('click', () =>
      this.hideMoreMenu()
    );
    requireButton('editor-json-open').addEventListener('click', () => {
      this.hideMoreMenu();
      this.handlers?.onJsonRequested();
    });
    requireButton('editor-json-cancel').addEventListener('click', () =>
      this.hideJsonDialog()
    );
    requireButton('editor-json-copy').addEventListener('click', () => {
      void this.copyJson();
    });
    this.copyCodeBtn.addEventListener('click', () => {
      void this.copyText(this.seedCode ?? '', 'Copied — paste it into seedLevels.ts.');
    });
    requireButton('editor-json-load').addEventListener('click', () => {
      const objects = parseDraftObjectsJson(this.jsonTextArea.value);
      if (!objects) {
        this.showJsonError(
          "That's not valid level JSON — expected an array of objects with id/type/x/y."
        );
        return;
      }
      this.handlers?.onJsonLoad(objects);
    });
  }

  private async copyJson(): Promise<void> {
    await this.copyText(this.jsonTextArea.value, 'Copied level JSON to clipboard.');
  }

  private async copyText(text: string, confirmation: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast(confirmation);
    } catch {
      this.showJsonError('Could not copy — your browser blocked clipboard access.');
    }
  }

  private showJsonError(message: string): void {
    this.jsonErrorEl.textContent = message;
    this.jsonErrorEl.classList.remove('hidden');
  }

  setHandlers(handlers: EditorToolbarHandlers): void {
    this.handlers = handlers;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.hidePublishDialog();
    this.hideMoreMenu();
    this.hideJsonDialog();
    this.hideMessage();
  }

  setEditingEnabled(enabled: boolean): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.id === 'editor-exit' || button.id.startsWith('editor-pan-')) continue;
      button.disabled = !enabled;
    }
  }

  setActiveTool(tool: EditorTool): void {
    for (const [t, button] of this.toolButtons) {
      button.classList.toggle('active', t === tool);
    }
  }

  setUndoRedoEnabled(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setDeleteEnabled(enabled: boolean): void {
    this.deleteBtn.disabled = !enabled;
  }

  setPublishEnabled(enabled: boolean): void {
    this.publishBtn.disabled = !enabled;
  }

  showMessage(message: string): void {
    this.messageEl.textContent = message;
    this.messageEl.classList.remove('hidden');
  }

  hideMessage(): void {
    this.messageEl.textContent = '';
    this.messageEl.classList.add('hidden');
  }

  showPublishDialog(): void {
    this.titleInput.value = '';
    this.publishDialog.classList.remove('hidden');
    this.titleInput.focus();
  }

  hidePublishDialog(): void {
    this.publishDialog.classList.add('hidden');
  }

  showMoreMenu(): void {
    this.moreDialog.classList.remove('hidden');
  }

  hideMoreMenu(): void {
    this.moreDialog.classList.add('hidden');
  }

  // Moderators only: the built-in levels they can open from More.
  setSeedLevels(levels: { levelId: string; title: string }[]): void {
    this.seedLevelListEl.replaceChildren(
      ...levels.map(({ levelId, title }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-btn editor-more-item';
        button.textContent = title;
        button.addEventListener('click', () => {
          this.hideMoreMenu();
          this.handlers?.onSeedLevelOpen(levelId);
        });
        return button;
      })
    );
    this.seedLevelsEl.classList.toggle('hidden', levels.length === 0);
  }

  // `objects` is always the editor's live state at the moment JSON is
  // requested — the textarea is prefilled from it, but from then on it's
  // just text the player can freely edit before Copy or Load. `seedCode`
  // is set while a moderator edits a built-in level.
  showJsonDialog(objects: DraftObject[], seedCode?: string): void {
    this.seedCode = seedCode;
    this.copyCodeBtn.classList.toggle('hidden', seedCode === undefined);
    this.jsonTextArea.value = JSON.stringify(objects, null, 2);
    this.jsonErrorEl.classList.add('hidden');
    this.jsonDialog.classList.remove('hidden');
    this.jsonTextArea.focus();
  }

  hideJsonDialog(): void {
    this.jsonDialog.classList.add('hidden');
  }
}
