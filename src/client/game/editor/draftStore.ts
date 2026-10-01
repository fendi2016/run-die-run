import type { DraftObject } from '../../../shared/editorApi';
import { isEditorDraftResponse } from '../../../shared/editorDraftApi';

const DRAFT_TIMEOUT_MS = 5000;

// The draft JSON the server is known to hold, so Exit can skip a save that
// would change nothing. Module-level because EditorScene restarts (after a
// Test run, a JSON load, or loading the draft itself) and this has to
// outlive any one scene instance.
let lastSavedJson: string | undefined;

export function markDraftSaved(objects: DraftObject[]): void {
  lastSavedJson = JSON.stringify(objects);
}

export function isDraftSaved(objects: DraftObject[]): boolean {
  return lastSavedJson === JSON.stringify(objects);
}

// The player's saved-for-later level, or null when there is none.
// Throws when the server can't be reached.
export async function loadDraft(): Promise<DraftObject[] | null> {
  const response = await fetch('/api/editor/draft', {
    signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
  });
  const json: unknown = await response.json();
  if (!response.ok || !isEditorDraftResponse(json)) {
    throw new Error('Unexpected draft response');
  }
  return json.objects;
}

// Resolves true once the server has the draft.
export async function saveDraft(objects: DraftObject[]): Promise<boolean> {
  try {
    const response = await fetch('/api/editor/draft', {
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    });
    if (!response.ok) return false;
    markDraftSaved(objects);
    return true;
  } catch {
    return false;
  }
}
