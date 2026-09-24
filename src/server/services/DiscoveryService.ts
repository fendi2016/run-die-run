import { redis } from '@devvit/web/server';
import type {
  Difficulty,
  DiscoverySort,
  LevelSummary,
  LevelStats,
} from '../../shared/discoveryApi';
import {
  allLevelsByDateKey,
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

export async function discoverLevels(
  sort: DiscoverySort
): Promise<LevelSummary[]> {
  const indexed = await redis.zRange(allLevelsByDateKey(), 0, -1, {
    by: 'rank',
  });
  const ids = new Set([
    ...Object.keys(SEED_LEVELS),
    ...indexed.map((entry) => entry.member),
  ]);
  const day = Math.floor(Date.now() / DAY_MS);
  // Bound fan-out as the catalog grows; each worker issues at most six
  // independent Redis reads at once. Preserve global sorting below.
  const pending = [...ids].values();
  const perLevel: (LevelSummary | undefined)[] = [];
  const summarize = async (
    levelId: string
  ): Promise<LevelSummary | undefined> => {
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
  };
  await Promise.all(
    Array.from({ length: Math.min(6, ids.size) }, async () => {
      for (const levelId of pending) perLevel.push(await summarize(levelId));
    })
  );
  const summaries = perLevel.filter((summary) => summary !== undefined);
  return summaries.sort((a, b) => {
    let order = 0;
    if (sort === 'new') order = b.createdAt - a.createdAt;
    if (sort === 'trending') order = b.trendingScore - a.trendingScore;
    if (sort === 'deadliest')
      order =
        Number(a.attempts === 0) - Number(b.attempts === 0) ||
        a.completionRate - b.completionRate;
    if (sort === 'speedrun')
      order = (a.worldRecordMs ?? Infinity) - (b.worldRecordMs ?? Infinity);
    return (
      order || b.createdAt - a.createdAt || a.levelId.localeCompare(b.levelId)
    );
  });
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
  return levelIds;
}
