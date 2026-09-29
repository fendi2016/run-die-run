import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type { TutorialStatusResponse } from '../../shared/tutorialApi';
import { userTutorialDoneKey } from '../core/redisKeys';

export const tutorial = new Hono();

// Logged-out viewers just get `done: false` — the client's own localStorage
// flag still covers them on this device.
tutorial.get('/', async (c) => {
  const { username } = context;
  if (!username) return c.json<TutorialStatusResponse>({ done: false });
  const done = (await redis.get(userTutorialDoneKey(username))) === '1';
  return c.json<TutorialStatusResponse>({ done });
});

tutorial.post('/done', async (c) => {
  const { username } = context;
  if (username) await redis.set(userTutorialDoneKey(username), '1');
  return c.json<TutorialStatusResponse>({ done: true });
});
