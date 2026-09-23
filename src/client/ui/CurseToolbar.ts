import {
  CURSE_CATEGORY_TYPES,
  type CurseCategory,
} from '../../shared/editorApi';
import type { ObjectType } from '../../shared/types';
import { requireButton, requireElement } from './domUtils';

const CATEGORIES: CurseCategory[] = ['hazard', 'platform', 'powerUp'];

// Only types the curse flow can actually offer today (spec sections 14-15
// scoped down to whatever CURSE_CATEGORY_TYPES currently lists — powerUp is
// empty until Phase 8, so its button stays disabled rather than offering a
// pickup ObjectRegistry can't render yet). A tuple array (not a
// Partial<Record> read back via Object.entries) keeps `type` typed as
// `ObjectType` at every call site without a cast (AGENTS.md: never cast
// TypeScript types).
const TYPE_BUTTON_ENTRIES: [ObjectType, string][] = [
  ['spike', 'curse-type-spike'],
  ['saw', 'curse-type-saw'],
  ['movingSaw', 'curse-type-movingSaw'],
  ['candle', 'curse-type-candle'],
  ['bat', 'curse-type-bat'],
  ['ghost', 'curse-type-ghost'],
  ['platform', 'curse-type-platform'],
  ['movingPlatform', 'curse-type-movingPlatform'],
  ['shield', 'curse-type-shield'],
  ['speedBoost', 'curse-type-speedBoost'],
];

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

  private readonly root = requireElement('curse-ui');
  private readonly messageEl = requireElement('curse-message');
  private readonly proveBtn = requireButton('curse-prove');
  private readonly clearBtn = requireButton('curse-clear');
  // Live in the palette next to the Platform type tiles, not the generic
  // action row — visible only while the Platform category is active (see
  // setActiveCategory), same discoverability reasoning as extendBtn always
  // having its own explicit button rather than only ever triggering
  // implicitly (see CurseScene.growExtensionToReach's comment).
  private readonly extendBtn = requireButton('curse-extend');
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

    for (const [objectType, id] of TYPE_BUTTON_ENTRIES) {
      const button = requireButton(id);
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
    requireButton('curse-cancel').addEventListener('click', () =>
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
    // Extend/Remove only make sense once Platform is the active category —
    // they live right beside its type tiles and stay hidden otherwise,
    // rather than cluttering the hazard/power-up screens with buttons that
    // don't apply there.
    const showPlatformActions = category === 'platform';
    this.extendBtn.classList.toggle('hidden', !showPlatformActions);
    this.removeBtn.classList.toggle('hidden', !showPlatformActions);
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
}
