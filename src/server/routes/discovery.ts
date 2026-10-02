import { reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import {
  isDiscoverySort,
  type DiscoveryResponse,
  type NextLevelResponse,
} from '../../shared/discoveryApi';
import { SEED_AUTHOR } from '../../shared/constants';
import { resolveLevelId } from '../services/DailyService';
import {
  discoverLevels,
  getLevelStats,
  nextNewestLevel,
} from '../services/DiscoveryService';

export const discovery = new Hono();

// Pages are cheap now (ordering comes from the sort indexes, only the
// page's own levels are read in full), but Browse opens and Next Level
// after every clear still add up across players. A short per-instance
// cache per page keeps that flat; 15s of staleness is invisible in a
// browse list. In memory rather than Redis: each warm serverless instance
// keeps its own copy, and nothing needs to invalidate it.
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; page: Promise<DiscoveryResponse> }>();

export function clearDiscoveryCache(): void {
  cache.clear();
}

function cachedPage(
  sort: Parameters<typeof discoverLevels>[0],
  cursor: number
): Promise<DiscoveryResponse> {
  const key = `${sort}:${cursor}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page;
  const page = discoverLevels(sort, cursor);
  cache.set(key, { at: Date.now(), page });
  // A failed read must not be served from cache for the rest of the TTL.
  page.catch(() => cache.delete(key));
  return page;
}
// Creator avatars for the feed card's credit. Every card view asks, so
// keep each lookup per warm instance for an hour; a failed or empty lookup
// is cached too (as undefined) so a user without a snoovatar costs one call.
const AVATAR_TTL_MS = 60 * 60_000;
const avatarCache = new Map<string, { at: number; url: Promise<string | undefined> }>();

function creatorAvatarUrl(username: string): Promise<string | undefined> {
  if (username === SEED_AUTHOR) return Promise.resolve(undefined);
  const hit = avatarCache.get(username);
  if (hit && Date.now() - hit.at < AVATAR_TTL_MS) return hit.url;
  const url = (async () => {
    try {
      return await reddit.getSnoovatarUrl(username);
    } catch {
      return undefined;
    }
  })();
  avatarCache.set(username, { at: Date.now(), url });
  return url;
}

discovery.get('/stats/:levelId', async (c) => {
  const stats = await getLevelStats(await resolveLevelId(c.req.param('levelId')));
  if (!stats) return c.json({ status: 'error', message: 'Unknown level' }, 404);
  const avatar = await creatorAvatarUrl(stats.creatorUsername);
  return c.json(avatar ? { ...stats, creatorAvatarUrl: avatar } : stats);
});
discovery.get('/levels', async (c) => {
  const sort = c.req.query('sort') ?? 'trending';
  if (!isDiscoverySort(sort))
    return c.json({ status: 'error', message: 'Unknown discovery sort' }, 400);
  const cursor = Number(c.req.query('cursor') ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    return c.json({ status: 'error', message: 'Invalid cursor' }, 400);
  return c.json<DiscoveryResponse>(await cachedPage(sort, cursor));
});
discovery.get('/next', async (c) => {
  const next = await nextNewestLevel(c.req.query('after') ?? '');
  return c.json<NextLevelResponse>({ next: next ?? null });
});
