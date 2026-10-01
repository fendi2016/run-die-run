import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import { isAnalyticsEventRequest } from '../../shared/analyticsApi';
import { trackLoadFailed, trackSafely } from '../services/AnalyticsService';

export const analytics = new Hono();

// Client-only events (see analyticsApi.ts). Always answers ok: a dropped
// analytics event must never surface to the player.
analytics.post('/event', async (c) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (!isAnalyticsEventRequest(body)) return c.json({ ok: false }, 400);
  if (body.event === 'loadFailed') {
    await trackLoadFailed().catch(() => undefined);
  } else {
    await trackSafely(body.event, context.username, {
      ...(body.device ? { device: body.device } : {}),
      ...(body.loadMs !== undefined ? { loadMs: body.loadMs } : {}),
    });
  }
  return c.json({ ok: true });
});
