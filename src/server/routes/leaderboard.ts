import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { LEADERBOARD_TOP_N } from '../../shared/constants';
import type { CursersLeaderboardResponse } from '../../shared/leaderboardApi';
import { levelContributorKillsKey, topCursersKey } from '../core/redisKeys';

export const leaderboard = new Hono();

// The one global leaderboard (spec section 24's "TOP CURSERS", generalized
// from per-level to the single board the UI shows) — highest trap-kill
// count first, across every level.
leaderboard.get('/', async (c) => {
  const topTenRaw = await redis.zRange(
    topCursersKey(),
    0,
    LEADERBOARD_TOP_N - 1,
    { by: 'rank', reverse: true }
  );
  return c.json<CursersLeaderboardResponse>({
    topTen: topTenRaw.map((entry) => ({
      username: entry.member,
      kills: entry.score,
    })),
  });
});

// Same shape as the global board above, scoped to one level's
// `levelContributorKillsKey` sorted set (written by runs.ts's trap-kill
// route on every attributed death, previously never read back anywhere).
leaderboard.get('/level/:levelId', async (c) => {
  const levelId = c.req.param('levelId');
  const topTenRaw = await redis.zRange(
    levelContributorKillsKey(levelId),
    0,
    LEADERBOARD_TOP_N - 1,
    { by: 'rank', reverse: true }
  );
  return c.json<CursersLeaderboardResponse>({
    topTen: topTenRaw.map((entry) => ({
      username: entry.member,
      kills: entry.score,
    })),
  });
});
