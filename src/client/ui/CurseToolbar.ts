import {
  CURSE_CATEGORY_TYPES,
  type CurseCategory,
} from '../../shared/editorApi';
import type { ObjectType } from '../../shared/types';
import { requireButton, requireElement } from './domUtils';

const CATEGORIES: CurseCategory[] = ['hazard', 'platform', 'powerUp'];

// Every type the curse flow can offer has a `curse-type-<type>` button.
const CURSE_TYPES: ObjectType[] = CATEGORIES.flatMap((category) => CURSE_CATEGORY_TYPES[category]);

export type CurseToolbarHandlers = {
  onCategorySelected: (category: CurseCategory) => void;
  onTypeSelected: (type: ObjectType) => void;
  onPanLeft: () => void;
  onPanRight: () => void;
  onExtend: () => void;
  onRemove: () => void;
  onClear: () => void;
  onProve: () => void;
  onCancel: () => void;
};

// DOM-based curse UI (spec section 15), following the same
// DOM-overlay-over-Phaser-canvas / singleton pattern as EditorToolbar —
// CurseScene's create() re-runs on every restart (a failed verification
// attempt relaunches the scene fresh), but this markup is static and
// outlives any one scene instance.
export class CurseToolbar {
  private static singleton: CurseToolbar | undefined;

  static instance(): CurseToolbar {
    return (CurseToolbar.singleton ??= new CurseToolbar());
  }

  private handlers: CurseToolbarHandlers | undefined;
  private readonly cancelBtn = requireButton('curse-cancel');
  private readonly cancelLabel = requireElement('curse-cancel-label');

  private readonly root = requireElement('curse-ui');
  private readonly messageEl = requireElement('curse-message');
  private readonly proveBtn = requireButton('curse-prove');
  private readonly clearBtn = requireButton('curse-clear');
  // Extend sits in the always-visible action row (not a category palette)
  // so players see they can lengthen the level whatever they're placing.
  private readonly extendBtn = requireButton('curse-extend');
  private readonly extendLabel = requireElement('curse-extend-label');
  // Erase lives in the palette next to the Hazard/Platform type tiles —
  // visible only while one of those is the active category (see
  // setActiveCategory).
  private readonly removeBtn = requireButton('curse-remove');
  private readonly categoryButtons = new Map<
    CurseCategory,
    HTMLButtonElement
  >();
  private readonly typeButtons = new Map<ObjectType, HTMLButtonElement>();

  private constructor() {
    for (const category of CATEGORIES) {
      const button = requireButton(`curse-category-${category}`);
      this.categoryButtons.set(category, button);
      button.disabled = CURSE_CATEGORY_TYPES[category].length === 0;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.setActiveCategory(category);
        this.handlers?.onCategorySelected(category);
      });
    }

    for (const objectType of CURSE_TYPES) {
      const button = requireButton(`curse-type-${objectType}`);
      this.typeButtons.set(objectType, button);
      button.addEventListener('click', () => {
        this.setActiveType(objectType);
        this.handlers?.onTypeSelected(objectType);
      });
    }

    requireButton('curse-pan-left').addEventListener('click', () =>
      this.handlers?.onPanLeft()
    );
    requireButton('curse-pan-right').addEventListener('click', () =>
      this.handlers?.onPanRight()
    );
    this.extendBtn.addEventListener('click', () => this.handlers?.onExtend());
    this.removeBtn.addEventListener('click', () => this.handlers?.onRemove());
    this.clearBtn.addEventListener('click', () => this.handlers?.onClear());
    this.proveBtn.addEventListener('click', () => this.handlers?.onProve());
    this.cancelBtn.addEventListener('click', () =>
      this.handlers?.onCancel()
    );
  }

  setHandlers(handlers: CurseToolbarHandlers): void {
    this.handlers = handlers;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.hideMessage();
  }

  setActiveCategory(category: CurseCategory | undefined): void {
    for (const [c, button] of this.categoryButtons) {
      button.classList.toggle('active', c === category);
    }
    this.setTypesForCategory(category);
    // Erase sits beside the type tiles under Hazard and Platform (what it
    // can take out), not under Power-Up, where it doesn't apply.
    this.removeBtn.classList.toggle(
      'hidden',
      category !== 'platform' && category !== 'hazard'
    );
  }

  setTypesForCategory(category: CurseCategory | undefined): void {
    const allowed = new Set(category ? CURSE_CATEGORY_TYPES[category] : []);
    for (const [type, button] of this.typeButtons) {
      button.classList.toggle('hidden', !allowed.has(type));
    }
  }

  setActiveType(type: ObjectType | undefined): void {
    for (const [t, button] of this.typeButtons) {
      button.classList.toggle('active', t === type);
    }
  }

  setEditingEnabled(enabled: boolean): void {
    for (const [category, button] of this.categoryButtons) {
      button.disabled = !enabled || CURSE_CATEGORY_TYPES[category].length === 0;
    }
    for (const button of this.typeButtons.values()) button.disabled = !enabled;
    this.clearBtn.disabled = !enabled;
    this.extendBtn.disabled = !enabled;
    this.removeBtn.disabled = !enabled;
  }

  // Marks the button done (highlighter + check badge) once the level is
  // at its full length, so a second tap isn't the only way to find out.
  setExtended(extended: boolean): void {
    this.extendBtn.classList.toggle('active', extended);
    this.extendLabel.textContent = extended ? 'Level Extended' : 'Extend Level';
  }

  setProveEnabled(enabled: boolean): void {
    this.proveBtn.disabled = !enabled;
  }

  setClearEnabled(enabled: boolean): void {
    this.clearBtn.disabled = !enabled;
  }

  showMessage(message: string): void {
    this.messageEl.textContent = message;
    this.messageEl.classList.remove('hidden');
  }

  hideMessage(): void {
    this.messageEl.textContent = '';
    this.messageEl.classList.add('hidden');
  }

  // "Cancel" on a real sabotage; "Skip" in the tutorial's practice trap.
  setCancelLabel(label: string): void {
    this.cancelLabel.textContent = label;
  }
}
