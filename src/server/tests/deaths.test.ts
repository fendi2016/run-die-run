import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { DEATH_BUCKET_PX } from '../../shared/deathsApi';
import {
  EDITOR_MAX_COLUMNS,
  FALL_DEATH_Y,
  GRID_CELL_SIZE,
} from '../../shared/constants';

// A minimal in-memory stand-in for the two Redis data shapes the deaths
// route touches: plain string values (levelVersionKey/levelCurrentVersionKey,
// read by LevelService) and sorted sets (levelDeathsKey's death-bucket
// histogram).
const values = new Map<string, string>();
const scores = new Map<string, Map<string, number>>();
let currentUsername: string | undefined = 'alice';

function zIncrBy(key: string, member: string, increment: number) {
  const entries = scores.get(key) ?? new Map<string, number>();
  const value = (entries.get(member) ?? 0) + increment;
  entries.set(member, value);
  scores.set(key, entries);
  return value;
}

function zRangeSorted(
  key: string,
  start: number,
  end: number,
  options?: { reverse?: boolean }
) {
  return [...(scores.get(key) ?? [])]
    .sort((a, b) => (options?.reverse ? b[1] - a[1] : a[1] - b[1]))
    .slice(start, end === -1 ? undefined : end + 1)
    .map(([member, score]) => ({ member, score }));
}

const redis = {
  get: async (key: string) => values.get(key),
  set: async (key: string, value: string) => {
    values.set(key, value);
    return 'OK';
  },
  exists: async (...keys: string[]) =>
    keys.filter((key) => values.has(key) || scores.has(key)).length,
  zIncrBy: async (key: string, member: string, increment: number) =>
    zIncrBy(key, member, increment),
  zRange: async (
    key: string,
    start: number,
    end: number,
    options?: { by: 'rank' | 'score' | 'lex'; reverse?: boolean }
  ) => zRangeSorted(key, start, end, options),
};

mock.module('@devvit/web/server', {
  namedExports: {
    redis,
    context: {
      get username() {
        return currentUsername;
      },
    },
  },
});

const { deaths } = await import('../routes/deaths');
const { getCurrentLevelVersion } = await import('../services/LevelService');
const { levelDeathsKey } = await import('../core/redisKeys');
const { isDeathMarkersResponse } = await import('../../shared/deathsApi');

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  values.clear();
  scores.clear();
  currentUsername = 'alice';
});

await test('reporting a death increments the bucket for its x/y position', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const x = 125; // bucket 6: floor(125 / 20)
  const y = 105; // bucket 5: floor(105 / 20)
  const response = await deaths.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, x, y })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(scores.get(levelDeathsKey('meat-grinder', 1))?.get('6:5'), 1);

  // A second death in the same bucket accumulates rather than overwriting.
  await deaths.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, x: 130, y: 110 })
  );
  assert.equal(scores.get(levelDeathsKey('meat-grinder', 1))?.get('6:5'), 2);
});

await test('reporting a death requires a signed-in user', async () => {
  currentUsername = undefined;
  await getCurrentLevelVersion('meat-grinder');
  const response = await deaths.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, x: 100, y: 100 })
  );
  assert.equal(response.status, 401);
});

await test('reporting a death rejects malformed and out-of-bounds x/y', async () => {
  await getCurrentLevelVersion('meat-grinder');
  for (const body of [
    null,
    {},
    { levelId: 'meat-grinder', version: 1 },
    { levelId: 'meat-grinder', version: 1, x: 'far', y: 100 },
    { levelId: 'meat-grinder', version: 1, x: 100, y: 'far' },
    { levelId: 'meat-grinder', version: 1, x: 100 },
  ]) {
    assert.equal((await deaths.request('/', post(body))).status, 400);
  }
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: -1, y: 100 })
      )
    ).status,
    400
  );
  const maxX = EDITOR_MAX_COLUMNS * GRID_CELL_SIZE;
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: maxX + 1, y: 100 })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: maxX, y: 100 })
      )
    ).status,
    200
  );
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: 100, y: -1 })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: 100, y: FALL_DEATH_Y + 1 })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 1, x: 100, y: FALL_DEATH_Y })
      )
    ).status,
    200
  );
});

await test('reporting a death rejects an unknown level or version', async () => {
  await getCurrentLevelVersion('meat-grinder');
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'no-such-level', version: 1, x: 0, y: 0 })
      )
    ).status,
    404
  );
  assert.equal(
    (
      await deaths.request(
        '/',
        post({ levelId: 'meat-grinder', version: 99, x: 0, y: 0 })
      )
    ).status,
    404
  );
});

await test('GET returns top buckets sorted highest-count-first, converted to bucket centers', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const key = levelDeathsKey('meat-grinder', 1);
  zIncrBy(key, '1:2', 3); // bucket (1,2) -> center (30, 50), count 3
  zIncrBy(key, '5:0', 7); // bucket (5,0) -> center (110, 10), count 7
  zIncrBy(key, '2:9', 1); // bucket (2,9) -> center (50, 190), count 1
  zIncrBy(key, 'garbage', 4); // malformed member, should be skipped on read

  const response = await deaths.request('/meat-grinder/1');
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(isDeathMarkersResponse(body));
  assert.equal(body.levelId, 'meat-grinder');
  assert.equal(body.version, 1);
  assert.deepEqual(body.markers, [
    { x: 5 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, y: 0 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, count: 7 },
    { x: 1 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, y: 2 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, count: 3 },
    { x: 2 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, y: 9 * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2, count: 1 },
  ]);
});

await test('GET returns an empty marker list for a version with no reported deaths', async () => {
  const response = await deaths.request('/meat-grinder/1');
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(isDeathMarkersResponse(body));
  assert.deepEqual(body.markers, []);
});

await test('GET rejects an invalid version param', async () => {
  assert.equal((await deaths.request('/meat-grinder/not-a-number')).status, 400);
  assert.equal((await deaths.request('/meat-grinder/0')).status, 400);
  assert.equal((await deaths.request('/meat-grinder/-1')).status, 400);
});
