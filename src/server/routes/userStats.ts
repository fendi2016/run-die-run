import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type { UserStatsResponse } from '../../shared/userStatsApi';
import {
  clearedVersionsKey,
  userContributionsKey,
  userCreatedLevelsKey,
  userStatsKey,
} from '../core/redisKeys';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const userStats = new Hono();

// Pulls together data that was already being written elsewhere
// (clearedVersionsKey by runs.ts, userCreatedLevelsKey by publish.ts,
// userContributionsKey by runs.ts's trap-kill route) plus totalClears — the
// one field userStatsKey actually needed a writer for (see runs.ts) — into a
// single personal-stats snapshot. Read-only; every individual counter is
// written from wherever the underlying event happens.
userStats.get('/me', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to view stats' },
      401
    );
  }

  const [clearStreak, levelsCreated, contributionKills, totalClears] =
    await Promise.all([
      redis.hLen(clearedVersionsKey(username)),
      redis.zCard(userCreatedLevelsKey(username)),
      redis.get(userContributionsKey(username)),
      redis.hGet(userStatsKey(username), 'totalClears'),
    ]);

  return c.json<UserStatsResponse>({
    username,
    clearStreak,
    // totalClears only started counting recently, while clearStreak is backed
    // by older data — every streak clear is also a clear, so floor it there.
    totalClears: Math.max(Number(totalClears ?? 0), clearStreak),
    levelsCreated,
    contributionKills: Number(contributionKills ?? 0),
  });
});
