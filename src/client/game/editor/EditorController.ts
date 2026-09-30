import { isSurfaceType, type DraftObject } from '../../../shared/editorApi';
import type { ObjectType } from '../../../shared/types';
import type { PlaceableObjectType } from './GridSystem';

function generateObjectId(type: ObjectType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// A surface (ground/platform) and the object resting on it occupy separate
// placement slots, so two objects only actually conflict when they share a
// cell AND are on the same one of those two layers (see isSurfaceType).
function occupiesSameSlot(
  o: DraftObject,
  x: number,
  y: number,
  type: ObjectType | PlaceableObjectType
): boolean {
  return o.x === x && o.y === y && isSurfaceType(o.type) === isSurfaceType(type);
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

  canMoveSelectedTo(x: number, y: number): boolean {
    const selected = this.objects.find((o) => o.id === this.selectedId);
    return (
      selected !== undefined &&
      !this.objects.some(
        (o) => o.id !== selected.id && occupiesSameSlot(o, x, y, selected.type)
      )
    );
  }

  // Whatever is on top in this cell: an object resting on a surface before
  // the surface itself.
  private topObjectAt(x: number, y: number): DraftObject | undefined {
    return (
      this.objects.find((o) => o.x === x && o.y === y && !isSurfaceType(o.type)) ??
      this.objects.find((o) => o.x === x && o.y === y)
    );
  }

  selectAt(x: number, y: number): boolean {
    const found = this.topObjectAt(x, y);
    this.selectedId = found?.id;
    return found !== undefined;
  }

  deselect(): void {
    this.selectedId = undefined;
  }

  placeObject(type: PlaceableObjectType, x: number, y: number): boolean {
    this.pushUndoSnapshot();
    this.objects = this.objects.filter((o) => !occupiesSameSlot(o, x, y, type));
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
      (o) => o.id === this.selectedId || !occupiesSameSlot(o, x, y, target.type)
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

  // The Erase tool's first pick: whatever is on top in this cell (the same
  // pick order as selectAt).
  topObjectIdAt(x: number, y: number): string | undefined {
    return this.topObjectAt(x, y)?.id;
  }

  eraseAt(x: number, y: number): DraftObject | 'spawn' | undefined {
    const id = this.topObjectIdAt(x, y);
    return id === undefined ? undefined : this.eraseById(id);
  }

  // The spawn can't be erased — a level needs one, so it's moved instead.
  // Returns the erased object, if any.
  eraseById(id: string): DraftObject | 'spawn' | undefined {
    const found = this.objects.find((o) => o.id === id);
    if (!found) return undefined;
    if (found.type === 'spawn') return 'spawn';
    this.pushUndoSnapshot();
    this.objects = this.objects.filter((o) => o.id !== found.id);
    if (this.selectedId === found.id) this.selectedId = undefined;
    return { ...found };
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
