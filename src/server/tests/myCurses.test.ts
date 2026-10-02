import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { GROUND_TOP_Y, SEED_AUTHOR } from '../../shared/constants';
import type { LevelObject, LevelVersion } from '../../shared/types';

// In-memory stand-in for the Redis shapes TrapStatsService and the
// /api/me/curses routes touch: strings (level versions, meta) and hashes.
const values = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
let currentUsername: string | undefined = 'alice';

function hash(key: string): Map<string, string> {
  const existing = hashes.get(key);
  if (existing) return existing;
  const created = new Map<string, string>();
  hashes.set(key, created);
  return created;
}

const redis = {
  get: async (key: string) => values.get(key),
  set: async (key: string, value: string) => {
    values.set(key, value);
    return 'OK';
  },
  exists: async (...keys: string[]) => keys.filter((key) => values.has(key)).length,
  hGet: async (key: string, field: string) => hashes.get(key)?.get(field),
  hGetAll: async (key: string) => Object.fromEntries(hashes.get(key) ?? []),
  hLen: async (key: string) => hashes.get(key)?.size ?? 0,
  hSet: async (key: string, fields: Record<string, string>) => {
    for (const [field, value] of Object.entries(fields)) hash(key).set(field, value);
    return Object.keys(fields).length;
  },
  hIncrBy: async (key: string, field: string, increment: number) => {
    const next = Number(hash(key).get(field) ?? 0) + increment;
    hash(key).set(field, String(next));
    return next;
  },
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

const { myCurses } = await import('../routes/myCurses');
const { recordCatch, recordPasses, cursePlacedFields } = await import('../services/TrapStatsService');
const { levelVersionKey, userCursesKey } = await import('../core/redisKeys');
const { isMyCursesResponse } = await import('../../shared/myCursesApi');

const obj = (id: string, type: LevelObject['type'], x: number, addedBy: string): LevelObject =>
  ({ id, type, x, y: GROUND_TOP_Y, properties: {}, addedBy, addedInVersion: 1 });

async function seedLevel(objects: LevelObject[]): Promise<void> {
  const level: LevelVersion = {
    levelId: 'lvl', version: 2, parentVersion: 1, objects,
    contributorUsername: SEED_AUTHOR, verificationTimeMs: 1, createdAt: 0,
  };
  await redis.set(levelVersionKey('lvl', 2), JSON.stringify(level));
}

async function listCurses() {
  const response = await myCurses.request('/');
  const body: unknown = await response.json();
  return { response, body };
}

beforeEach(async () => {
  values.clear();
  hashes.clear();
  currentUsername = 'alice';
  await seedLevel([obj('trap', 'candle', 600, 'alice'), obj('other', 'saw', 900, 'bob')]);
  await redis.hSet(userCursesKey('alice'), cursePlacedFields('trap', 'lvl', 'candle'));
});

await test('a placed curse is listed with zero catches and passes', async () => {
  const { body } = await listCurses();
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses.length, 1);
  assert.deepEqual(
    { ...body.curses[0], placedAt: 0 },
    { objectId: 'trap', levelId: 'lvl', levelTitle: 'lvl', type: 'candle', placedAt: 0,
      caught: 0, passed: 0, newCaught: 0, newPassed: 0 }
  );
});

await test('catches count unique players and never the trap owner', async () => {
  await recordCatch('trap', 'alice', 'bob');
  await recordCatch('trap', 'alice', 'bob');
  await recordCatch('trap', 'alice', 'carol');
  await recordCatch('trap', 'alice', 'alice');
  const { body } = await listCurses();
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses[0]?.caught, 2);
});

await test('passes come from reaching past the trap or clearing, never from the owner', async () => {
  await recordPasses('lvl', 2, 'bob', 700);
  await recordPasses('lvl', 2, 'bob', 800);
  await recordPasses('lvl', 2, 'carol', 'clear');
  await recordPasses('lvl', 2, 'dave', 610);
  await recordPasses('lvl', 2, 'alice', 'clear');
  const { body } = await listCurses();
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses[0]?.passed, 2);
});

await test('seen snapshots reset the "new" counts', async () => {
  await recordCatch('trap', 'alice', 'bob');
  let { body } = await listCurses();
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses[0]?.newCaught, 1);
  assert.equal((await myCurses.request('/seen', { method: 'POST' })).status, 200);
  ({ body } = await listCurses());
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses[0]?.newCaught, 0);
  await recordCatch('trap', 'alice', 'carol');
  ({ body } = await listCurses());
  assert.ok(isMyCursesResponse(body));
  assert.equal(body.curses[0]?.newCaught, 1);
});

await test('signed out gets 401 on both routes', async () => {
  currentUsername = undefined;
  assert.equal((await myCurses.request('/')).status, 401);
  assert.equal((await myCurses.request('/seen', { method: 'POST' })).status, 401);
});

await test('deadliestTrap picks the hazard with the most kills, above the floor', async () => {
  const { deadliestTrap } = await import('../services/TrapStatsService');
  const { levelCurrentVersionKey, trapKillsKey } = await import('../core/redisKeys');
  await redis.set(levelCurrentVersionKey('lvl'), '2');
  assert.equal(await deadliestTrap('lvl'), undefined);
  await redis.set(trapKillsKey('trap'), '4');
  assert.equal(await deadliestTrap('lvl'), undefined, 'below the minimum it stays hidden');
  await redis.set(trapKillsKey('other'), '340');
  assert.deepEqual(await deadliestTrap('lvl'), { kills: 340, addedBy: 'bob' });
});
