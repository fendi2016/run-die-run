import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { LEADERBOARD_TOP_N, SEED_AUTHOR } from '../../shared/constants';
import type { CursersLeaderboardResponse } from '../../shared/leaderboardApi';
import { levelContributorKillsKey, topCursersKey } from '../core/redisKeys';

export const leaderboard = new Hono();

// The built-in levels' traps belong to the seed account, which isn't a
// player. runs.ts no longer credits it; this also hides kills it was
// credited before that.
async function topCursers(key: string): Promise<CursersLeaderboardResponse> {
  const raw = await redis.zRange(key, 0, LEADERBOARD_TOP_N, { by: 'rank', reverse: true });
  return {
    topTen: raw
      .filter((entry) => entry.member !== SEED_AUTHOR)
      .slice(0, LEADERBOARD_TOP_N)
      .map((entry) => ({ username: entry.member, kills: entry.score })),
  };
}

// The one global leaderboard (spec section 24's "TOP CURSERS", generalized
// from per-level to the single board the UI shows) — highest trap-kill
// count first, across every level.
leaderboard.get('/', async (c) => {
  return c.json<CursersLeaderboardResponse>(await topCursers(topCursersKey()));
});

// Same shape as the global board above, scoped to one level's
// `levelContributorKillsKey` sorted set (written by runs.ts's trap-kill
// route on every attributed death, previously never read back anywhere).
leaderboard.get('/level/:levelId', async (c) => {
  const levelId = c.req.param('levelId');
  return c.json<CursersLeaderboardResponse>(
    await topCursers(levelContributorKillsKey(levelId))
  );
});
