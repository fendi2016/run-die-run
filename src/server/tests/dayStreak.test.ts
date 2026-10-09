import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, mock, test } from 'node:test';

const hashes = new Map<string, Record<string, string>>();
mock.module('@devvit/web/server', {
  namedExports: {
    redis: {
      hGetAll: async (key: string) => hashes.get(key) ?? {},
      hSet: async (key: string, fields: Record<string, string>) => {
        hashes.set(key, { ...hashes.get(key), ...fields });
        return Object.keys(fields).length;
      },
    },
  },
});

const { recordClearDay } = await import('../services/DayStreakService');
const { DAILY_LEVEL_HOUR_UTC, msUntilNextDaily } = await import('../../shared/constants');

const DAY = 86_400_000;
const day0 = Date.parse('2026-10-01T12:00:00Z');

beforeEach(() => hashes.clear());

await test('day streak grows on consecutive days, holds within a day, and resets after a gap', async () => {
  assert.equal(await recordClearDay('alice', day0), 1);
  assert.equal(await recordClearDay('alice', day0 + 1000), 1);
  assert.equal(await recordClearDay('alice', day0 + DAY), 2);
  assert.equal(await recordClearDay('alice', day0 + 2 * DAY), 3);
  assert.equal(await recordClearDay('alice', day0 + 4 * DAY), 1);
  assert.equal(await recordClearDay('bob', day0 + 4 * DAY), 1);
});

await test('the next Level of the Day countdown matches the daily-level cron', async () => {
  const config: unknown = JSON.parse(await readFile('devvit.json', 'utf8'));
  assert.match(JSON.stringify(config), new RegExp(`"cron":"0 ${DAILY_LEVEL_HOUR_UTC} \\* \\* \\*"`));
  assert.equal(msUntilNextDaily(Date.parse('2026-10-01T12:00:00Z')), 4 * 3_600_000);
  assert.equal(msUntilNextDaily(Date.parse('2026-10-01T16:00:00Z')), DAY);
  assert.equal(msUntilNextDaily(Date.parse('2026-10-01T20:30:00Z')), 19.5 * 3_600_000);
});
