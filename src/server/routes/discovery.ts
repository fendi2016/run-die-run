import { Hono } from 'hono';
import {
  isDiscoverySort,
  type DiscoverySort,
  type DiscoveryResponse,
  type LevelSummary,
} from '../../shared/discoveryApi';
import { discoverLevels, getLevelStats } from '../services/DiscoveryService';

export const discovery = new Hono();

// discoverLevels reads every level's counters, and it runs on every Browse
// open and after every clear (Next Level). A short per-instance cache keeps
// that from scaling with player count; 15s of staleness is invisible in a
// browse list. In memory rather than Redis: each warm serverless instance
// keeps its own copy, and nothing needs to invalidate it.
const CACHE_TTL_MS = 15_000;
const cache = new Map<DiscoverySort, { at: number; levels: Promise<LevelSummary[]> }>();

export function clearDiscoveryCache(): void {
  cache.clear();
}

function cachedLevels(sort: DiscoverySort): Promise<LevelSummary[]> {
  const hit = cache.get(sort);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.levels;
  const levels = discoverLevels(sort);
  cache.set(sort, { at: Date.now(), levels });
  // A failed read must not be served from cache for the rest of the TTL.
  levels.catch(() => cache.delete(sort));
  return levels;
}
discovery.get('/stats/:levelId', async (c) => {
  const stats = await getLevelStats(c.req.param('levelId'));
  if (!stats) return c.json({ status: 'error', message: 'Unknown level' }, 404);
  return c.json(stats);
});
discovery.get('/levels', async (c) => {
  const sort = c.req.query('sort') ?? 'trending';
  if (!isDiscoverySort(sort))
    return c.json({ status: 'error', message: 'Unknown discovery sort' }, 400);
  return c.json<DiscoveryResponse>({ levels: await cachedLevels(sort) });
});
