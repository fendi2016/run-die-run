import { redis } from '@devvit/web/server';
import { userDayStreakKey } from '../core/redisKeys';

const DAY_MS = 24 * 60 * 60 * 1000;

// Days in a row (UTC) the player has cleared at least one level. Called on
// every clear: a second clear the same day keeps the count, a clear the
// next day adds one, and a missed day starts over at 1.
export async function recordClearDay(username: string, now = Date.now()): Promise<number> {
  const key = userDayStreakKey(username);
  const today = Math.floor(now / DAY_MS);
  const stored = await redis.hGetAll(key);
  const lastDay = Number(stored?.day);
  const lastCount = Number(stored?.count) || 0;
  const count = lastDay === today ? lastCount : lastDay === today - 1 ? lastCount + 1 : 1;
  if (lastDay !== today) await redis.hSet(key, { day: String(today), count: String(count) });
  return Math.max(count, 1);
}
