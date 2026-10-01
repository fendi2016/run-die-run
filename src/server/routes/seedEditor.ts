import { Hono } from 'hono';
import type { SeedLevelsResponse } from '../../shared/seedEditorApi';
import { isModerator } from '../core/moderators';
import { SEED_LEVELS, SEED_TITLES } from '../core/seedLevels';

export const seedEditor = new Hono();

// Built-in levels for a moderator to open in the editor and copy back out
// as seedLevels.ts code. Nothing here writes: the levels stay in source.
seedEditor.get('/', async (c) => {
  if (!(await isModerator())) return c.json<SeedLevelsResponse>({ levels: [] });
  const levels = Object.values(SEED_LEVELS).map((level) => ({
    levelId: level.levelId,
    title: SEED_TITLES[level.levelId] ?? level.levelId,
    objects: level.objects.map(({ id, type, x, y }) => ({ id, type, x, y })),
    verificationTimeMs: level.verificationTimeMs,
  }));
  return c.json<SeedLevelsResponse>({ levels });
});
