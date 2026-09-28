import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import type { MyCursesResponse } from '../../shared/myCursesApi';
import { getMyCurses, markCursesSeen } from '../services/TrapStatsService';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const myCurses = new Hono();

// The signed-in player's curses with their caught/passed counts (and what's
// new since POST /seen). Shown in the stats screen and as the STATS badge.
myCurses.get('/', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Must be signed in to see your curses' }, 401);
  }
  return c.json<MyCursesResponse>({ curses: await getMyCurses(username) });
});

myCurses.post('/seen', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Must be signed in' }, 401);
  }
  await markCursesSeen(username);
  return c.json({ ok: true });
});
