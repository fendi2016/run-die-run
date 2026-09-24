import { showToast } from '@devvit/web/client';
import { parseDraftObjectsJson, type DraftObject } from '../../shared/editorApi';
import { PLACEABLE_TYPES, type EditorTool } from '../game/editor/GridSystem';
import {
  requireButton,
  requireElement,
  requireInput,
  requireTextArea,
} from './domUtils';

const TOOL_IDS: EditorTool[] = ['select', ...PLACEABLE_TYPES];

export type EditorToolbarHandlers = {
  onToolSelected: (tool: EditorTool) => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onTest: () => void;
  onPublishRequested: () => void;
  onPublishConfirm: (title: string) => void;
  onPublishCancel: () => void;
  onJsonRequested: () => void;
  onJsonLoad: (objects: DraftObject[]) => void;
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
  private readonly jsonDialog = requireElement('editor-json-dialog');
  private readonly jsonTextArea = requireTextArea('editor-json-textarea');
  private readonly jsonErrorEl = requireElement('editor-json-error');
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
    requireButton('editor-json').addEventListener('click', () =>
      this.handlers?.onJsonRequested()
    );
    requireButton('editor-json-cancel').addEventListener('click', () =>
      this.hideJsonDialog()
    );
    requireButton('editor-json-copy').addEventListener('click', () => {
      void this.copyJson();
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
    try {
      await navigator.clipboard.writeText(this.jsonTextArea.value);
      showToast('Copied level JSON to clipboard.');
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

  // `objects` is always the editor's live state at the moment JSON is
  // requested — the textarea is prefilled from it, but from then on it's
  // just text the player can freely edit before Copy or Load.
  showJsonDialog(objects: DraftObject[]): void {
    this.jsonTextArea.value = JSON.stringify(objects, null, 2);
    this.jsonErrorEl.classList.add('hidden');
    this.jsonDialog.classList.remove('hidden');
    this.jsonTextArea.focus();
  }

  hideJsonDialog(): void {
    this.jsonDialog.classList.add('hidden');
  }
}
