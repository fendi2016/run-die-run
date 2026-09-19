import { redis } from '@devvit/web/server';
import type {
  Difficulty,
  DiscoverySort,
  LevelSummary,
} from '../../shared/discoveryApi';
import {
  allLevelsByDateKey,
  levelAttemptsKey,
  levelClearsKey,
  levelDailyPlayersKey,
  levelDailyClearsKey,
  levelMetaKey,
  versionLeaderboardKey,
} from '../core/redisKeys';
import { SEED_LEVELS } from '../core/seedLevels';
import { getCurrentLevelVersion } from './LevelService';

type Transaction = Awaited<ReturnType<typeof redis.watch>>;
const DAY_MS = 86400000;

export function difficultyFor(attempts: number, clears: number): Difficulty {
  if (attempts === 0) return 'UNRATED';
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
  // Attempts cover submitted clears and reported trap deaths; falls and abandoned runs are unobserved.
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
  // Every level's data is independent, so all of them are fetched
  // concurrently instead of one at a time — a sequential `for` loop here
  // turned a browse-page request into N back-to-back round trips, growing
  // linearly worse as more levels get published.
  const perLevel = await Promise.all(
    [...ids].map(async (levelId): Promise<LevelSummary | undefined> => {
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
        title: meta?.title ?? levelId.replaceAll('-', ' '),
        creatorUsername:
          meta?.creatorUsername ?? seed?.contributorUsername ?? '',
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
