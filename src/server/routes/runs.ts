import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { versionLeaderboardKey } from '../core/redisKeys';
import type {
  LeaderboardEntry,
  SubmitRunRequest,
  SubmitRunResponse,
} from '../../shared/runsApi';

type ErrorResponse = {
  status: 'error';
  message: string;
};

// Sanity bound only, not real anti-cheat (spec section 36: build reasonable
// server authority first, don't spend weeks on anti-cheat before the core
// game is proven).
const MAX_REASONABLE_TIME_MS = 10 * 60 * 1000;

function isValidSubmission(
  body: Partial<SubmitRunRequest>
): body is SubmitRunRequest {
  return (
    typeof body.levelId === 'string' &&
    body.levelId.length > 0 &&
    typeof body.version === 'number' &&
    Number.isInteger(body.version) &&
    body.version >= 1 &&
    typeof body.timeMs === 'number' &&
    Number.isFinite(body.timeMs) &&
    body.timeMs > 0 &&
    body.timeMs <= MAX_REASONABLE_TIME_MS
  );
}

export const runs = new Hono();

runs.post('/', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to submit a run' },
      401
    );
  }

  let body: Partial<SubmitRunRequest>;
  try {
    body = await c.req.json<Partial<SubmitRunRequest>>();
  } catch {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid request body' },
      400
    );
  }

  if (!isValidSubmission(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid run submission' },
      400
    );
  }
  const { levelId, version, timeMs } = body;

  const leaderboardKey = versionLeaderboardKey(levelId, version);
  const existingScore = await redis.zScore(leaderboardKey, username);

  let personalBestMs: number;
  let isNewPersonalBest: boolean;
  if (existingScore === undefined || timeMs < existingScore) {
    await redis.zAdd(leaderboardKey, { member: username, score: timeMs });
    personalBestMs = timeMs;
    isNewPersonalBest = true;
  } else {
    personalBestMs = existingScore;
    isNewPersonalBest = false;
  }

  const rankIndex = await redis.zRank(leaderboardKey, username);
  const rank = (rankIndex ?? 0) + 1;

  const topTenRaw = await redis.zRange(leaderboardKey, 0, 9, { by: 'rank' });
  const topTen: LeaderboardEntry[] = topTenRaw.map((entry) => ({
    username: entry.member,
    timeMs: entry.score,
  }));
  const worldRecordMs = topTen[0]?.timeMs ?? personalBestMs;

  return c.json<SubmitRunResponse>({
    timeMs,
    rank,
    personalBestMs,
    isNewPersonalBest,
    worldRecordMs,
    topTen,
  });
});
