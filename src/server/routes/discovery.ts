import { Hono } from 'hono';
import {
  isDiscoverySort,
  type DiscoveryResponse,
} from '../../shared/discoveryApi';
import { discoverLevels, getLevelStats } from '../services/DiscoveryService';

export const discovery = new Hono();
discovery.get('/stats/:levelId', async (c) => {
  const stats = await getLevelStats(c.req.param('levelId'));
  if (!stats) return c.json({ status: 'error', message: 'Unknown level' }, 404);
  return c.json(stats);
});
discovery.get('/levels', async (c) => {
  const sort = c.req.query('sort') ?? 'trending';
  if (!isDiscoverySort(sort))
    return c.json({ status: 'error', message: 'Unknown discovery sort' }, 400);
  return c.json<DiscoveryResponse>({ levels: await discoverLevels(sort) });
});
