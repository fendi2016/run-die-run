import { redis } from '@devvit/web/server';
import { createLevelPost } from '../core/post';
import {
  dailyCountKey,
  dailyFeaturedKey,
  dailyLastPostedDayKey,
} from '../core/redisKeys';
import { discoverLevels } from './DiscoveryService';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyPostResult =
  | { status: 'posted'; number: number; levelId: string; url: string }
  | { status: 'skipped'; reason: string };

// A fresh post every day is what gives the subreddit a reason to come
// back. Picks the top trending level never featured before, else the one
// featured longest ago. `force` (the mod menu) skips the once-per-UTC-day
// guard that stops a retried cron run from double-posting.
export async function postLevelOfTheDay(force: boolean): Promise<DailyPostResult> {
  const today = Math.floor(Date.now() / DAY_MS);
  if (!force && Number(await redis.get(dailyLastPostedDayKey())) === today) {
    return { status: 'skipped', reason: 'Already posted today' };
  }

  const [levels, featured] = await Promise.all([
    discoverLevels('trending'),
    redis.hGetAll(dailyFeaturedKey()),
  ]);
  const pick =
    levels.find((level) => featured[level.levelId] === undefined) ??
    [...levels].sort(
      (a, b) => Number(featured[a.levelId]) - Number(featured[b.levelId])
    )[0];
  if (!pick) return { status: 'skipped', reason: 'No levels to feature' };

  const number = Number(await redis.get(dailyCountKey())) + 1;
  const post = await createLevelPost({
    levelId: pick.levelId,
    title: pick.title,
    creatorUsername: pick.creatorUsername,
    daily: number,
  });
  await Promise.all([
    redis.set(dailyCountKey(), String(number)),
    redis.set(dailyLastPostedDayKey(), String(today)),
    redis.hSet(dailyFeaturedKey(), { [pick.levelId]: String(today) }),
  ]);
  return { status: 'posted', number, levelId: pick.levelId, url: post.url };
}
