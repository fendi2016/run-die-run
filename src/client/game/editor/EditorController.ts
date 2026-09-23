import type { DraftObject } from '../../../shared/editorApi';
import {
  computeLevelExtension,
  maxExtendableTiles,
} from '../../../shared/levelExtend';
import type { ObjectType } from '../../../shared/types';
import type { PlaceableObjectType } from './GridSystem';

function generateObjectId(type: ObjectType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Ground and the object resting on it occupy separate placement slots, so
// two objects only actually conflict when they share a cell AND are on the
// same one of those two layers.
function occupiesSameSlot(
  o: DraftObject,
  x: number,
  y: number,
  type: ObjectType | PlaceableObjectType
): boolean {
  return o.x === x && o.y === y && (o.type === 'ground') === (type === 'ground');
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

  // Maxes out the ground past whatever's currently the rightmost tile in
  // one shot (not a re-tappable small chunk — one click is meant to be
  // enough) and relocates the finish to sit at the new end — see
  // shared/levelExtend.ts for why this lives there (the curse flow's own
  // "Extend Level" needs the exact same computation). Returns false with
  // no-op when the level is already at its max width (EDITOR_MAX_COLUMNS),
  // same "tell the caller nothing changed" contract as every other mutator
  // here.
  extendLevel(): boolean {
    const extension = computeLevelExtension(
      this.objects,
      maxExtendableTiles(this.objects),
      () => generateObjectId('ground'),
      () => generateObjectId('finish')
    );
    if (!extension) {
      return false;
    }
    this.pushUndoSnapshot();
    this.objects = [
      ...this.objects.filter((o) => o.type !== 'finish'),
      ...extension.groundTiles,
      extension.finish,
    ];
    this.selectedId = undefined;
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
