import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { isDraftObject, parseDraftObjectsJson } from '../../shared/editorApi';
import type { EditorDraftResponse } from '../../shared/editorDraftApi';
import { editorDraftKey } from '../core/redisKeys';

export const editorDraft = new Hono();

// A sanity bound only: a draft is unfinished work, so it may be over the
// publish limit (EDITOR_MAX_OBJECTS) while the player is still trimming it.
const MAX_DRAFT_OBJECTS = 1000;

function isSaveBody(body: unknown): body is { objects: unknown[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'objects' in body &&
    Array.isArray(body.objects)
  );
}

editorDraft.get('/', async (c) => {
  const { username } = context;
  if (!username) return c.json<EditorDraftResponse>({ objects: null });
  const stored = await redis.get(editorDraftKey(username));
  const objects = stored ? parseDraftObjectsJson(stored) : null;
  return c.json<EditorDraftResponse>({ objects });
});

editorDraft.put('/', async (c) => {
  const { username } = context;
  if (!username) return c.json({ status: 'error', message: 'Sign in to save.' }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (
    !isSaveBody(body) ||
    body.objects.length > MAX_DRAFT_OBJECTS ||
    !body.objects.every(isDraftObject)
  ) {
    return c.json({ status: 'error', message: 'Invalid level.' }, 400);
  }
  await redis.set(editorDraftKey(username), JSON.stringify(body.objects));
  return c.json({ status: 'ok' });
});

editorDraft.delete('/', async (c) => {
  const { username } = context;
  if (username) await redis.del(editorDraftKey(username));
  return c.json({ status: 'ok' });
});
