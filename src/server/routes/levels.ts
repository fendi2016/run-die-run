import { Hono } from 'hono';
import { DEFAULT_LEVEL_ID } from '../../shared/constants';
import { resolveLevelId } from '../services/DailyService';
import { getCurrentLevelVersion } from '../services/LevelService';
import type { LevelVersion } from '../../shared/types';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const levels = new Hono();

levels.get('/:levelId', async (c) => {
  const requestedId = c.req.param('levelId');
  const levelId = await resolveLevelId(requestedId);
  // A hub post must always get something playable, even if the featured
  // level has since gone missing.
  const levelVersion =
    (await getCurrentLevelVersion(levelId)) ??
    (levelId !== requestedId ? await getCurrentLevelVersion(DEFAULT_LEVEL_ID) : undefined);

  if (!levelVersion) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `Unknown level "${levelId}"` },
      404
    );
  }

  return c.json<LevelVersion>(levelVersion);
});
