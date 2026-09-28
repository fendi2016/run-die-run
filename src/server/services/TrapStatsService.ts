import { redis } from '@devvit/web/server';
import { SEED_AUTHOR } from '../../shared/constants';
import type { MyCurse } from '../../shared/myCursesApi';
import { passedHazardIds } from '../../shared/trapStats';
import { isLevelVersion, isObjectType, type ObjectType } from '../../shared/types';
import {
  levelVersionKey,
  trapCaughtByKey,
  trapPassedByKey,
  userCursesKey,
  userCursesSeenKey,
} from '../core/redisKeys';
import { getLevelStats } from './DiscoveryService';

// Feedback for curse owners: which unique players each of their traps
// caught and which got past it. Counted per player, not per attempt, and
// never the owner's own runs. Every writer is best-effort — callers catch.
const MAX_LISTED = 20;

export async function recordCatch(objectId: string, addedBy: string, username: string): Promise<void> {
  if (addedBy === username || addedBy === SEED_AUTHOR) return;
  await redis.hIncrBy(trapCaughtByKey(objectId), username, 1);
}

export async function recordPasses(
  levelId: string,
  version: number,
  username: string,
  reachedX: number | 'clear'
): Promise<void> {
  const raw = await redis.get(levelVersionKey(levelId, version));
  if (raw === undefined) return;
  const level: unknown = JSON.parse(raw);
  if (!isLevelVersion(level)) return;
  await Promise.all(
    passedHazardIds(level.objects, reachedX, username).map((id) =>
      redis.hSet(trapPassedByKey(id), { [username]: '1' })
    )
  );
}

// The userCursesKey entry for a newly published curse.
export function cursePlacedFields(objectId: string, levelId: string, type: ObjectType): Record<string, string> {
  return { [objectId]: JSON.stringify({ levelId, type, placedAt: Date.now() }) };
}

type PlacedCurse = { levelId: string; type: ObjectType; placedAt: number };
type SeenCounts = { caught: number; passed: number };

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlacedCurse(value: unknown): value is PlacedCurse {
  return (
    typeof value === 'object' && value !== null &&
    'levelId' in value && typeof value.levelId === 'string' &&
    'type' in value && isObjectType(value.type) &&
    'placedAt' in value && typeof value.placedAt === 'number'
  );
}

function seenCounts(value: unknown): SeenCounts {
  if (
    typeof value === 'object' && value !== null &&
    'caught' in value && typeof value.caught === 'number' &&
    'passed' in value && typeof value.passed === 'number'
  ) {
    return { caught: value.caught, passed: value.passed };
  }
  return { caught: 0, passed: 0 };
}

export async function getMyCurses(username: string): Promise<MyCurse[]> {
  const [placed, seen] = await Promise.all([
    redis.hGetAll(userCursesKey(username)),
    redis.hGetAll(userCursesSeenKey(username)),
  ]);
  const entries = Object.entries(placed)
    .flatMap(([objectId, raw]) => {
      const meta = parseJson(raw);
      return isPlacedCurse(meta) ? [{ objectId, meta }] : [];
    })
    .sort((a, b) => b.meta.placedAt - a.meta.placedAt)
    .slice(0, MAX_LISTED);
  return Promise.all(
    entries.map(async ({ objectId, meta }) => {
      const [caught, passed, stats] = await Promise.all([
        redis.hLen(trapCaughtByKey(objectId)),
        redis.hLen(trapPassedByKey(objectId)),
        getLevelStats(meta.levelId),
      ]);
      const before = seenCounts(parseJson(seen[objectId]));
      return {
        objectId,
        levelId: meta.levelId,
        levelTitle: stats?.title ?? meta.levelId,
        type: meta.type,
        placedAt: meta.placedAt,
        caught,
        passed,
        newCaught: Math.max(0, caught - before.caught),
        newPassed: Math.max(0, passed - before.passed),
      };
    })
  );
}

export async function markCursesSeen(username: string): Promise<void> {
  const curses = await getMyCurses(username);
  if (curses.length === 0) return;
  await redis.hSet(
    userCursesSeenKey(username),
    Object.fromEntries(
      curses.map((c) => [c.objectId, JSON.stringify({ caught: c.caught, passed: c.passed })])
    )
  );
}
