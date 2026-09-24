import { redis } from '@devvit/web/server';
import { dailyQuotaKey } from './redisKeys';

const DAY_MS = 24 * 60 * 60 * 1000;
const currentDay = (): number => Math.floor(Date.now() / DAY_MS);

// Checked before the work and recorded only after it succeeds, so a failed
// or conflicted publish never burns one of the player's daily uses. The
// check and the record aren't atomic — two perfectly simultaneous requests
// can both pass at the boundary — which is fine for a flood cap.
export async function hasDailyQuota(
  action: string,
  username: string,
  limit: number
): Promise<boolean> {
  const used = await redis.get(dailyQuotaKey(action, username, currentDay()));
  return Number(used ?? 0) < limit;
}

export async function recordDailyUse(
  action: string,
  username: string
): Promise<void> {
  const key = dailyQuotaKey(action, username, currentDay());
  const used = await redis.incrBy(key, 1);
  if (used === 1) await redis.expire(key, (2 * DAY_MS) / 1000);
}
