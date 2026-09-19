import type { DraftObject } from '../../../shared/editorApi';
import type { ObjectType } from '../../../shared/types';
import type { PlaceableObjectType } from './GridSystem';

function generateObjectId(type: ObjectType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Spawn/finish are singletons: placing a new one replaces the old one
// rather than erroring, since re-placing to relocate is the natural way a
// tap-only editor lets you move a "special" marker without a dedicated
// move-only mode for just those two types.
const SINGLETON_TYPES: ReadonlySet<ObjectType> = new Set(['spawn', 'finish']);

// Owns the editor's draft object list, selection, and undo/redo history
// (spec section 12). GridSystem handles coordinate math; this class only
// knows object identity and mutation, never pixels or grid cells — callers
// pass already-snapped x/y. Every mutating method returns whether it
// actually changed anything, so EditorScene can tell a real edit apart
// from a rejected no-op (occupied cell, nothing selected, ...).
export class EditorController {
  private objects: DraftObject[];
  private selectedId: string | undefined;
  private undoStack: DraftObject[][] = [];
  private redoStack: DraftObject[][] = [];

  constructor(initialObjects: DraftObject[]) {
    this.objects = initialObjects.map((o) => ({ ...o }));
  }

  getObjects(): DraftObject[] {
    return this.objects.map((o) => ({ ...o }));
  }

  getSelectedId(): string | undefined {
    return this.selectedId;
  }

  isSelectedAt(x: number, y: number): boolean {
    const selected = this.objects.find((o) => o.id === this.selectedId);
    return selected !== undefined && selected.x === x && selected.y === y;
  }

  hasObjectAt(x: number, y: number): boolean {
    return this.objects.some((o) => o.x === x && o.y === y);
  }

  selectAt(x: number, y: number): boolean {
    const found =
      this.objects.find((o) => o.x === x && o.y === y && o.type !== 'ground') ??
      this.objects.find((o) => o.x === x && o.y === y);
    this.selectedId = found?.id;
    return found !== undefined;
  }

  deselect(): void {
    this.selectedId = undefined;
  }

  // Ground and the object resting on it occupy separate placement slots.
  placeObject(type: PlaceableObjectType, x: number, y: number): boolean {
    this.pushUndoSnapshot();
    this.objects = this.objects.filter((o) => o.x !== x || o.y !== y || (o.type === 'ground') !== (type === 'ground'));
    if (SINGLETON_TYPES.has(type)) {
      this.objects = this.objects.filter((o) => o.type !== type);
    }
    this.objects.push({ id: generateObjectId(type), type, x, y });
    this.selectedId = undefined;
    return true;
  }

  moveSelectedTo(x: number, y: number): boolean {
    if (!this.selectedId) {
      return false;
    }
    const target = this.objects.find((o) => o.id === this.selectedId);
    if (!target) {
      return false;
    }
    this.pushUndoSnapshot();
    this.objects = this.objects.filter(
      (o) => o.id === this.selectedId || o.x !== x || o.y !== y || (o.type === 'ground') !== (target.type === 'ground')
    );
    target.x = x;
    target.y = y;
    return true;
  }

  deleteSelected(): boolean {
    if (!this.selectedId) {
      return false;
    }
    this.pushUndoSnapshot();
    this.objects = this.objects.filter((o) => o.id !== this.selectedId);
    this.selectedId = undefined;
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) {
      return false;
    }
    this.redoStack.push(this.objects.map((o) => ({ ...o })));
    this.objects = previous;
    this.selectedId = undefined;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) {
      return false;
    }
    this.undoStack.push(this.objects.map((o) => ({ ...o })));
    this.objects = next;
    this.selectedId = undefined;
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushUndoSnapshot(): void {
    this.undoStack.push(this.objects.map((o) => ({ ...o })));
    this.redoStack = [];
  }
}
