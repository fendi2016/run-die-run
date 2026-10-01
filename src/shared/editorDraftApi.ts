import { isDraftObject, type DraftObject } from './editorApi';

// Wire contract for /api/editor/draft — the player's one saved-for-later
// builder level. GET reads it (`objects: null` when there is none), PUT
// saves it, DELETE clears it.
export type EditorDraftResponse = {
  objects: DraftObject[] | null;
};

export type SaveEditorDraftRequest = {
  objects: DraftObject[];
};

export function isEditorDraftResponse(value: unknown): value is EditorDraftResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objects' in value &&
    (value.objects === null ||
      (Array.isArray(value.objects) && value.objects.every(isDraftObject)))
  );
}
