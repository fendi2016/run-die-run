import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

// In-memory stand-in for the Redis shapes AnalyticsService touches:
// strings, hashes and sorted sets.
const values = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const sets = new Map<string, Map<string, number>>();
let currentUsername: string | undefined = 'alice';

function hash(key: string): Map<string, string> {
  const existing = hashes.get(key) ?? new Map<string, string>();
  hashes.set(key, existing);
  return existing;
}
function zset(key: string): Map<string, number> {
  const existing = sets.get(key) ?? new Map<string, number>();
  sets.set(key, existing);
  return existing;
}

const redis = {
  get: async (key: string) => values.get(key),
  set: async (key: string, value: string) => {
    values.set(key, value);
    return 'OK';
  },
  expire: async () => undefined,
  hIncrBy: async (key: string, field: string, increment: number) => {
    const next = Number(hash(key).get(field) ?? 0) + increment;
    hash(key).set(field, String(next));
    return next;
  },
  hGetAll: async (key: string) => Object.fromEntries(hashes.get(key) ?? []),
  zAdd: async (key: string, ...members: { member: string; score: number }[]) => {
    let added = 0;
    for (const { member, score } of members) {
      if (!zset(key).has(member)) added++;
      zset(key).set(member, score);
    }
    return added;
  },
  zCard: async (key: string) => sets.get(key)?.size ?? 0,
  zRange: async (key: string) =>
    [...(sets.get(key) ?? [])].map(([member, score]) => ({ member, score })),
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

const { track, trackLoadFailed, buildReport } = await import('../services/AnalyticsService');
const { analytics } = await import('../routes/analytics');

const DAY = 86_400_000;
const day0 = Date.parse('2026-10-01T12:00:00Z');

beforeEach(() => {
  values.clear();
  hashes.clear();
  sets.clear();
  currentUsername = 'alice';
});

await test('counts players per day, new vs returning, and day-1/day-7 returns', async () => {
  await track('open', 'alice', { now: day0, device: 'mobile', loadMs: 1500 });
  await track('open', 'bob', { now: day0, device: 'desktop', loadMs: 5000 });
  // A second open the same day counts the event but not a second player.
  await track('open', 'alice', { now: day0 + 1000, device: 'mobile', loadMs: 1200 });
  await track('death', 'alice', { now: day0 + DAY });
  await track('play', 'bob', { now: day0 + 7 * DAY });

  const report = await buildReport(7, day0 + 7 * DAY);
  assert.match(report.retention, /10-01 {2}2 new → next day 1 \(50%\) · day 7 1 \(50%\)/);

  const firstDay = await buildReport(1, day0);
  assert.match(firstDay.players, /^2 different players in the last 1 days\./);
  assert.match(firstDay.players, /10-01 {2}2 players · 2 new · 1 mobile \/ 1 desktop/);
  assert.match(firstDay.players, /Device split: 50% mobile\./);
  assert.match(firstDay.activity, /Game opens: 3/);
  assert.match(firstDay.load, /under 2s: 2 \(67%\)/);
  assert.match(firstDay.load, /4–8s: 1 \(33%\)/);
});

await test('a feed card view alone is not an active player, and logged-out views only add to totals', async () => {
  await track('card', 'carol', { now: day0 });
  await track('card', undefined, { now: day0 });
  const report = await buildReport(1, day0);
  assert.match(report.players, /^0 different players/);
  assert.match(report.funnel, /Feed card views incl\. logged out: 2\./);
  assert.match(report.funnel, /Saw the feed card: 1/);
});

await test('the funnel counts each player once per step, as a share of openers', async () => {
  for (const name of ['alice', 'bob', 'carol', 'dave']) await track('open', name, { now: day0 });
  await track('play', 'alice', { now: day0 });
  await track('play', 'bob', { now: day0 });
  await track('clear', 'alice', { now: day0 });
  await track('clear', 'alice', { now: day0 + DAY });
  await trackLoadFailed(day0);
  const report = await buildReport(7, day0 + DAY);
  assert.match(report.funnel, /Opened the game: 4\n/);
  assert.match(report.funnel, /Started a run: 2 \(50% of openers\)/);
  assert.match(report.funnel, /Cleared a level: 1 \(25% of openers\)/);
  assert.match(report.activity, /Clears: 2/);
  assert.match(report.load, /Failed to load: 1/);
});

await test('the event route accepts client events and rejects anything else', async () => {
  const post = (body: unknown) =>
    analytics.request('/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ event: 'open', device: 'mobile', loadMs: 900 })).status, 200);
  assert.equal((await post({ event: 'death' })).status, 400);
  assert.equal((await post({ event: 'open', device: 'fridge' })).status, 400);
  assert.equal((await post({ event: 'open', loadMs: -1 })).status, 400);
  const report = await buildReport(1);
  assert.match(report.players, /^1 different players/);
});
