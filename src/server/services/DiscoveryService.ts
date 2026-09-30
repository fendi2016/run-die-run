import { redis } from '@devvit/web/server';
import type {
  Difficulty,
  DiscoverySort,
  LevelSummary,
  LevelStats,
} from '../../shared/discoveryApi';
import {
  allLevelsByDateKey,
  discoveryIndexKey,
  discoveryIndexVersionKey,
  discoveryTrendingKey,
  levelAttemptsKey,
  levelClearsKey,
  levelCurrentVersionKey,
  levelDailyPlayersKey,
  levelDailyClearsKey,
  levelMetaKey,
  levelPostKey,
  versionLeaderboardKey,
} from '../core/redisKeys';
import { levelDisplayTitle, SEED_LEVELS } from '../core/seedLevels';
import { getCurrentLevelVersion } from './LevelService';

type Transaction = Awaited<ReturnType<typeof redis.watch>>;
const DAY_MS = 86400000;

// Below this many attempts a clear rate is noise (two lucky clears read as
// EASY), so the level stays UNRATED until enough people have tried it.
export const MIN_RATED_ATTEMPTS = 20;

export function difficultyFor(attempts: number, clears: number): Difficulty {
  if (attempts < MIN_RATED_ATTEMPTS) return 'UNRATED';
  const rate = clears / attempts;
  if (rate > 0.5) return 'EASY';
  if (rate >= 0.25) return 'NORMAL';
  if (rate >= 0.1) return 'HARD';
  if (rate >= 0.03) return 'CURSED';
  return 'NIGHTMARE';
}

export async function queueDiscoveryActivity(
  tx: Transaction,
  levelId: string,
  username: string,
  cleared: boolean
): Promise<void> {
  const day = Math.floor(Date.now() / DAY_MS);
  const playersKey = levelDailyPlayersKey(levelId, day);
  // Attempts cover submitted clears, trap deaths and falls; abandoned runs are unobserved.
  await tx.incrBy(levelAttemptsKey(levelId), 1);
  await tx.zIncrBy(playersKey, username, 1);
  await tx.expire(playersKey, (2 * DAY_MS) / 1000);
  if (cleared) {
    const dailyClearsKey = levelDailyClearsKey(levelId, day);
    await tx.incrBy(levelClearsKey(levelId), 1);
    await tx.incrBy(dailyClearsKey, 1);
    await tx.expire(dailyClearsKey, (2 * DAY_MS) / 1000);
  }
}

function metadata(
  raw: string | undefined
): { title: string; creatorUsername: string; createdAt: number } | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'title' in value &&
      typeof value.title === 'string' &&
      'creatorUsername' in value &&
      typeof value.creatorUsername === 'string' &&
      'createdAt' in value &&
      typeof value.createdAt === 'number' &&
      Number.isSafeInteger(value.createdAt) &&
      value.createdAt >= 0
    )
      return {
        title: value.title,
        creatorUsername: value.creatorUsername,
        createdAt: value.createdAt,
      };
  } catch {
    return undefined;
  }
  return undefined;
}

// Feed impressions need only a handful of plain keys, never every level's
// objects, daily players, and leaderboards.
export async function getLevelStats(
  levelId: string
): Promise<LevelStats | undefined> {
  const [rawMeta, rawAttempts, rawClears, rawVersion, postId] =
    await Promise.all([
      redis.get(levelMetaKey(levelId)),
      redis.get(levelAttemptsKey(levelId)),
      redis.get(levelClearsKey(levelId)),
      redis.get(levelCurrentVersionKey(levelId)),
      redis.get(levelPostKey(levelId)),
    ]);
  const meta = metadata(rawMeta);
  const seed = SEED_LEVELS[levelId];
  if (!meta && !seed) return undefined;
  const attempts = Number(rawAttempts ?? 0);
  const clears = Number(rawClears ?? 0);
  const stats: LevelStats = {
    title: levelDisplayTitle(levelId, meta?.title),
    creatorUsername: meta?.creatorUsername ?? seed?.contributorUsername ?? '',
    // A seed level has no current-version key until its first load.
    version: Number(rawVersion ?? 1),
    attempts,
    clears,
    difficulty: difficultyFor(attempts, clears),
  };
  return postId ? { ...stats, postId } : stats;
}

// Browse pages are this many cards; the client asks for the next page.
export const DISCOVERY_PAGE_SIZE = 30;
// Bumping this rebuilds every index from the level data on the next read.
const DISCOVERY_INDEX_VERSION = '1';
// Sentinel scores for the ascending sorts: unplayed levels sort after every
// real completion rate (0..1), levels without a record after every time.
const UNPLAYED_SCORE = 2;
const NO_RECORD_SCORE = Number.MAX_SAFE_INTEGER;

const today = (): number => Math.floor(Date.now() / DAY_MS);

async function summarizeLevel(
  levelId: string,
  day: number
): Promise<LevelSummary | undefined> {
  const level = await getCurrentLevelVersion(levelId);
  if (!level) return undefined;
  const [rawMeta, rawAttempts, rawClears, players, dailyClears, records] =
    await Promise.all([
      redis.get(levelMetaKey(levelId)),
      redis.get(levelAttemptsKey(levelId)),
      redis.get(levelClearsKey(levelId)),
      redis.zRange(levelDailyPlayersKey(levelId, day), 0, -1, {
        by: 'rank',
      }),
      redis.get(levelDailyClearsKey(levelId, day)),
      redis.zRange(versionLeaderboardKey(levelId, level.version), 0, 0, {
        by: 'rank',
      }),
    ]);
  const meta = metadata(rawMeta);
  const seed = SEED_LEVELS[levelId];
  if (!meta && !seed) return undefined;
  const attempts = Number(rawAttempts ?? 0);
  const clears = Number(rawClears ?? 0);
  return {
    levelId,
    title: levelDisplayTitle(levelId, meta?.title),
    creatorUsername: meta?.creatorUsername ?? seed?.contributorUsername ?? '',
    createdAt: meta?.createdAt ?? seed?.createdAt ?? level.createdAt,
    version: level.version,
    attempts,
    clears,
    difficulty: difficultyFor(attempts, clears),
    completionRate: attempts === 0 ? 0 : clears / attempts,
    worldRecordMs: records[0]?.score ?? null,
    // Reading the current version here includes curses without adding a second publish-time write.
    trendingScore:
      players.length +
      players.reduce((total, entry) => total + entry.score, 0) +
      Number(dailyClears ?? 0) +
      level.version -
      1,
  };
}

// Runs `task` over `items` with at most six in flight, keeping input order.
async function mapBounded<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  // One shared iterator: each worker takes the next unclaimed item.
  const pending = items.entries();
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      for (const [index, item] of pending) results[index] = await task(item);
    })
  );
  return results;
}

async function writeIndexes(summary: LevelSummary, day: number): Promise<void> {
  const member = summary.levelId;
  await Promise.all([
    redis.zAdd(discoveryIndexKey('createdAt'), {
      member,
      score: summary.createdAt,
    }),
    redis.zAdd(discoveryIndexKey('deadliest'), {
      member,
      score: summary.attempts === 0 ? UNPLAYED_SCORE : summary.completionRate,
    }),
    redis.zAdd(discoveryIndexKey('speedrun'), {
      member,
      score: summary.worldRecordMs ?? NO_RECORD_SCORE,
    }),
    redis.zAdd(discoveryIndexKey('curses'), {
      member,
      score: summary.version - 1,
    }),
    redis.zAdd(discoveryTrendingKey(day), {
      member,
      score: summary.trendingScore,
    }),
  ]);
  await redis.expire(discoveryTrendingKey(day), (2 * DAY_MS) / 1000);
}

// Re-score one level in every Browse index. Call after anything that
// changes what a listing shows for it: a publish, a curse, or a run.
export async function refreshDiscoveryIndex(levelId: string): Promise<void> {
  const day = today();
  const summary = await summarizeLevel(levelId, day);
  if (summary) await writeIndexes(summary, day);
}

// The same, but for callers that must not fail once their own write has
// committed — a stale Browse position is better than an error.
export async function refreshDiscoveryIndexSafely(
  levelId: string
): Promise<void> {
  try {
    await refreshDiscoveryIndex(levelId);
  } catch (error) {
    console.error(`Discovery index refresh failed for ${levelId}`, error);
  }
}

// One-time backfill (and schema upgrade): scores every level from its data.
// This is the old full scan, so it only runs when the indexes are missing.
async function ensureDiscoveryIndexes(): Promise<void> {
  if ((await redis.get(discoveryIndexVersionKey())) === DISCOVERY_INDEX_VERSION)
    return;
  const indexed = await redis.zRange(allLevelsByDateKey(), 0, -1, {
    by: 'rank',
  });
  const ids = [
    ...new Set([
      ...Object.keys(SEED_LEVELS),
      ...indexed.map((entry) => entry.member),
    ]),
  ];
  const day = today();
  await mapBounded(ids, async (levelId) => {
    const summary = await summarizeLevel(levelId, day);
    if (summary) await writeIndexes(summary, day);
  });
  await redis.set(discoveryIndexVersionKey(), DISCOVERY_INDEX_VERSION);
}

async function indexScores(key: string): Promise<Map<string, number>> {
  const entries = await redis.zRange(key, 0, -1, { by: 'rank' });
  return new Map(entries.map((entry) => [entry.member, entry.score]));
}

// Every indexed level id in `sort` order. Reads only index members and
// scores (no per-level keys); ties fall back to newest first, then id.
export async function orderedLevelIds(sort: DiscoverySort): Promise<string[]> {
  await ensureDiscoveryIndexes();
  const createdAt = await indexScores(discoveryIndexKey('createdAt'));
  let score: (levelId: string) => number;
  let descending: boolean;
  if (sort === 'new') {
    score = (levelId) => createdAt.get(levelId) ?? 0;
    descending = true;
  } else if (sort === 'trending') {
    // A level played today carries its full score in today's set; every
    // other level's trending score is just its curse count.
    const [curses, active] = await Promise.all([
      indexScores(discoveryIndexKey('curses')),
      indexScores(discoveryTrendingKey(today())),
    ]);
    score = (levelId) => active.get(levelId) ?? curses.get(levelId) ?? 0;
    descending = true;
  } else {
    const scores = await indexScores(discoveryIndexKey(sort));
    const fallback = sort === 'deadliest' ? UNPLAYED_SCORE : NO_RECORD_SCORE;
    score = (levelId) => scores.get(levelId) ?? fallback;
    descending = false;
  }
  return [...createdAt.keys()].sort((a, b) => {
    const order = descending ? score(b) - score(a) : score(a) - score(b);
    return (
      order ||
      (createdAt.get(b) ?? 0) - (createdAt.get(a) ?? 0) ||
      a.localeCompare(b)
    );
  });
}

// One Browse page: ordering comes from the indexes, and only the page's
// own levels are read in full.
export async function discoverLevels(
  sort: DiscoverySort,
  cursor = 0
): Promise<{ levels: LevelSummary[]; nextCursor: number | null }> {
  const ids = await orderedLevelIds(sort);
  const end = cursor + DISCOVERY_PAGE_SIZE;
  const day = today();
  const page = await mapBounded(ids.slice(cursor, end), (levelId) =>
    summarizeLevel(levelId, day)
  );
  return {
    levels: page.filter((summary) => summary !== undefined),
    nextCursor: end < ids.length ? end : null,
  };
}

// Next Level after a clear: the level after `levelId` in the newest-first
// order, wrapping round, or undefined when there's no other level.
export async function nextNewestLevel(
  levelId: string
): Promise<{ levelId: string; title: string } | undefined> {
  const ids = await orderedLevelIds('new');
  const index = ids.indexOf(levelId);
  const candidates = ids
    .slice(index + 1)
    .concat(ids.slice(0, Math.max(0, index)))
    .filter((id) => id !== levelId);
  // A few tries only: an id whose level data is gone is skipped.
  for (const id of candidates.slice(0, 5)) {
    const stats = await getLevelStats(id);
    if (stats) return { levelId: id, title: stats.title };
  }
  return undefined;
}

// Dev/moderator tool: zero a built-in level's attempt/clear counters (and
// the rolling daily window trending reads), e.g. after pre-launch testing
// inflated them. Curses are real published versions and are left alone.
export async function resetBuiltInLevelStats(): Promise<string[]> {
  const day = Math.floor(Date.now() / DAY_MS);
  const levelIds = Object.keys(SEED_LEVELS);
  await Promise.all(
    levelIds.map((levelId) =>
      redis.del(
        levelAttemptsKey(levelId),
        levelClearsKey(levelId),
        levelDailyPlayersKey(levelId, day),
        levelDailyPlayersKey(levelId, day - 1),
        levelDailyClearsKey(levelId, day),
        levelDailyClearsKey(levelId, day - 1)
      )
    )
  );
  await Promise.all(levelIds.map((levelId) => refreshDiscoveryIndex(levelId)));
  return levelIds;
}
