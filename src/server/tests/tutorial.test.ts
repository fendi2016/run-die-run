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

const { tutorial } = await import('../routes/tutorial');
const { isTutorialStatusResponse } = await import('../../shared/tutorialApi');

async function status(): Promise<boolean> {
  const body: unknown = await (await tutorial.request('/')).json();
  assert.ok(isTutorialStatusResponse(body));
  return body.done;
}

beforeEach(() => {
  values.clear();
  currentUsername = 'alice';
});

await test('the tutorial is remembered per player once marked done', async () => {
  assert.equal(await status(), false);
  assert.equal((await tutorial.request('/done', { method: 'POST' })).status, 200);
  assert.equal(await status(), true);
  currentUsername = 'bob';
  assert.equal(await status(), false);
});

await test('a signed-out viewer is never marked done server-side', async () => {
  currentUsername = undefined;
  assert.equal((await tutorial.request('/done', { method: 'POST' })).status, 200);
  assert.equal(await status(), false);
  assert.equal(values.size, 0);
});
