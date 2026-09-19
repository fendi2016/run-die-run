import { Hono } from 'hono';
import {
  isDiscoverySort,
  type DiscoveryResponse,
} from '../../shared/discoveryApi';
import { discoverLevels } from '../services/DiscoveryService';

export const discovery = new Hono();
discovery.get('/levels', async (c) => {
  const sort = c.req.query('sort') ?? 'trending';
  if (!isDiscoverySort(sort))
    return c.json({ status: 'error', message: 'Unknown discovery sort' }, 400);
  return c.json<DiscoveryResponse>({ levels: await discoverLevels(sort) });
});
