import { Hono } from 'hono';
import { getCurrentLevelVersion } from '../services/LevelService';
import type { LevelVersion } from '../../shared/types';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const levels = new Hono();

levels.get('/:levelId', async (c) => {
  const levelId = c.req.param('levelId');
  const levelVersion = await getCurrentLevelVersion(levelId);

  if (!levelVersion) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `Unknown level "${levelId}"` },
      404
    );
  }

  return c.json<LevelVersion>(levelVersion);
});
