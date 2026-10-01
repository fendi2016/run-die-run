import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { isT3, type FormField, type UiResponse } from '@devvit/web/shared';
import { GRID_CELL_SIZE, HUB_LEVEL_ID } from '../../shared/constants';
import { levelIdFromPostData } from '../../shared/postData';
import { createHubPost } from '../core/post';
import { postLevelOfTheDay, resolveLevelId } from '../services/DailyService';
import { getLevelStats } from '../services/DiscoveryService';
import { listRemovableTraps, removeTrap, undoLatestSabotage } from '../services/UndoService';
import { labelFor } from '../../shared/objectLabels';
import { isObjectType } from '../../shared/types';
import {
  refreshDiscoveryIndex,
  resetBuiltInLevelStats,
} from '../services/DiscoveryService';
import { reseedBuiltInLevels } from '../services/LevelService';
import { buildReport } from '../services/AnalyticsService';

export const menu = new Hono();
export const forms = new Hono();

// Moderator-only usage report (see AnalyticsService): the last 7 days,
// shown read-only in a form.
menu.post('/analytics', async (c) => {
  try {
    const report = await buildReport();
    const section = (name: string, label: string, text: string, lines: number): FormField => ({
      type: 'paragraph',
      name,
      label,
      defaultValue: text,
      lineHeight: lines,
      disabled: true,
    });
    return c.json<UiResponse>({
      showForm: {
        name: 'analyticsReport',
        form: {
          title: 'SKETCHY stats (last 7 days, UTC)',
          acceptLabel: 'Done',
          fields: [
            section('players', 'Players', report.players, 9),
            section('retention', 'Coming back (by first day)', report.retention, 6),
            section('funnel', 'Funnel', report.funnel, 9),
            section('activity', 'Activity', report.activity, 4),
            section('load', 'Loading', report.load, 7),
          ],
        },
      },
    });
  } catch (error) {
    console.error(`Error building analytics report: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to load stats' }, 400);
  }
});

// The report form has nothing to submit; closing it just lands here.
forms.post('/analytics-report', (c) => c.json<UiResponse>({}));

// Dev utility (see LevelService.reseedBuiltInLevels): a source edit to a
// seed level in seedLevels.ts never reaches a subreddit where that level
// was already requested once, since levels only seed on first request.
// This forces every built-in level's stored data back in sync with
// whatever seedLevels.ts currently says, without touching any real
// published level.
menu.post('/reseed-levels', async (c) => {
  try {
    const levelIds = await reseedBuiltInLevels();
    await Promise.all(levelIds.map((levelId) => refreshDiscoveryIndex(levelId)));
    return c.json<UiResponse>(
      { showToast: `Reseeded ${levelIds.length} built-in levels` },
      200
    );
  } catch (error) {
    console.error(`Error reseeding built-in levels: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to reseed levels' }, 400);
  }
});

menu.post('/post-create', async (c) => {
  try {
    const post = await createHubPost();

    return c.json<UiResponse>(
      {
        navigateTo: post.url,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});

// Same as the daily cron, on demand (launch day, or a missed run). Always
// posts, even if today's already went out.
menu.post('/daily-level', async (c) => {
  try {
    const result = await postLevelOfTheDay(true);
    if (result.status === 'skipped') {
      return c.json<UiResponse>({ showToast: result.reason }, 200);
    }
    return c.json<UiResponse>({ navigateTo: result.url }, 200);
  } catch (error) {
    console.error(`Error posting Level of the Day: ${error}`);
    return c.json<UiResponse>(
      { showToast: 'Failed to post Level of the Day' },
      400
    );
  }
});

menu.post('/reset-builtin-stats', async (c) => {
  try {
    const levelIds = await resetBuiltInLevelStats();
    return c.json<UiResponse>(
      { showToast: `Stats reset on ${levelIds.length} built-in levels` },
      200
    );
  } catch (error) {
    console.error(`Error resetting built-in level stats: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to reset stats' }, 400);
  }
});

// Post menu: take the latest sabotage back out of the level this post plays
// (see UndoService), for a level that got too hard for anyone to beat.
// Pressing it again undoes the one before.
menu.post('/undo-sabotage', async (c) => {
  try {
    const levelId = await levelIdForMenuTarget(await c.req.json());
    if (!levelId) return c.json<UiResponse>({ showToast: 'Use this on a SKETCHY post' }, 400);
    const result = await undoLatestSabotage(levelId);
    if (result.status === 'error') {
      return c.json<UiResponse>({ showToast: result.message }, 200);
    }
    const what = isObjectType(result.undoneType) ? labelFor(result.undoneType) : 'sabotage';
    const left = (await getLevelStats(levelId))?.sabotages ?? 0;
    return c.json<UiResponse>(
      {
        showToast: `Removed u/${result.undoneBy}'s ${what}. ${left} sabotage${left === 1 ? '' : 's'} left.`,
      },
      200
    );
  } catch (error) {
    console.error(`Error undoing sabotage: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to undo sabotage' }, 400);
  }
});

// The level a post-menu action targets: the post's own level (a hub post
// plays the hub level).
async function levelIdForMenuTarget(body: unknown): Promise<string | undefined> {
  if (
    typeof body !== 'object' || body === null ||
    !('targetId' in body) || typeof body.targetId !== 'string' || !isT3(body.targetId)
  ) {
    return undefined;
  }
  const post = await reddit.getPostById(body.targetId);
  return resolveLevelId(levelIdFromPostData(await post.getPostData()) ?? HUB_LEVEL_ID);
}

// Post menu: pick one player-added trap on this post's level and remove it
// (see UndoService.removeTrap). Built-in and creator traps aren't listed.
menu.post('/remove-trap', async (c) => {
  try {
    const levelId = await levelIdForMenuTarget(await c.req.json());
    if (!levelId) return c.json<UiResponse>({ showToast: 'Use this on a SKETCHY post' }, 400);
    const traps = await listRemovableTraps(levelId);
    if (traps.length === 0) {
      return c.json<UiResponse>({ showToast: 'No player traps on this level.' });
    }
    return c.json<UiResponse>({
      showForm: {
        name: 'removeTrap',
        form: {
          title: 'Remove a trap',
          description: 'Only traps players added are listed. The player gets that trap back to place again.',
          acceptLabel: 'Remove',
          fields: [
            {
              type: 'select',
              name: 'trap',
              label: 'Trap',
              required: true,
              options: traps.map((trap) => ({
                label: `${labelFor(trap.type)} · column ${Math.floor(trap.x / GRID_CELL_SIZE) + 1} · u/${trap.addedBy}`,
                value: JSON.stringify([levelId, trap.id]),
              })),
            },
          ],
        },
      },
    });
  } catch (error) {
    console.error(`Error listing traps: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to list traps' }, 400);
  }
});

async function isModerator(): Promise<boolean> {
  const { username, subredditName } = context;
  if (!username || !subredditName) return false;
  const mods = await reddit.getModerators({ subredditName, username }).all();
  return mods.some((mod) => mod.username.toLowerCase() === username.toLowerCase());
}

function parseTrapChoice(body: unknown): [string, string] | undefined {
  if (typeof body !== 'object' || body === null || !('trap' in body)) return undefined;
  const choice: unknown = Array.isArray(body.trap) ? body.trap[0] : body.trap;
  if (typeof choice !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(choice);
    if (
      Array.isArray(parsed) && parsed.length === 2 &&
      typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Not one of our options.
  }
  return undefined;
}

forms.post('/remove-trap', async (c) => {
  try {
    if (!(await isModerator())) {
      return c.json<UiResponse>({ showToast: 'Only moderators can remove traps.' }, 403);
    }
    const choice = parseTrapChoice(await c.req.json());
    if (!choice) return c.json<UiResponse>({ showToast: 'Pick a trap to remove.' }, 400);
    const result = await removeTrap(...choice);
    if (result.status === 'error') return c.json<UiResponse>({ showToast: result.message });
    const what = isObjectType(result.removedType) ? labelFor(result.removedType) : 'trap';
    return c.json<UiResponse>({ showToast: `Removed u/${result.removedBy}'s ${what}.` });
  } catch (error) {
    console.error(`Error removing trap: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to remove the trap' }, 400);
  }
});
