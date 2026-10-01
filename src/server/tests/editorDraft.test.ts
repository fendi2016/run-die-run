import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const values = new Map<string, string>();
let currentUsername: string | undefined = 'alice';

mock.module('@devvit/web/server', {
  namedExports: {
    redis: {
      get: async (key: string) => values.get(key),
      set: async (key: string, value: string) => {
        values.set(key, value);
        return 'OK';
      },
    },
    context: {
      get username() {
        return currentUsername;
      },
    },
  },
});

const { editorDraft } = await import('../routes/editorDraft');
const { isEditorDraftResponse } = await import('../../shared/editorDraftApi');

const LEVEL = [
  { id: 'spawn-default', type: 'spawn', x: 96, y: 640 },
  { id: 'g1', type: 'ground', x: 160, y: 640 },
];

async function load(): Promise<unknown[] | null> {
  const body: unknown = await (await editorDraft.request('/')).json();
  assert.ok(isEditorDraftResponse(body));
  return body.objects;
}

async function save(objects: unknown): Promise<Response> {
  return editorDraft.request('/', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objects }),
  });
}

beforeEach(() => {
  values.clear();
  currentUsername = 'alice';
});

await test('a saved builder draft comes back for its owner only', async () => {
  assert.equal(await load(), null);
  assert.equal((await save(LEVEL)).status, 200);
  assert.deepEqual(await load(), LEVEL);
  currentUsername = 'bob';
  assert.equal(await load(), null);
});

await test('a malformed or signed-out draft save is refused', async () => {
  assert.equal((await save([{ id: 'x' }])).status, 400);
  assert.equal((await save('nope')).status, 400);
  currentUsername = undefined;
  assert.equal((await save(LEVEL)).status, 401);
  assert.equal(values.size, 0);
});
