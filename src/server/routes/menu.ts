import { Hono } from 'hono';
import type { FormField, UiResponse } from '@devvit/web/shared';
import { createHubPost } from '../core/post';
import { postLevelOfTheDay } from '../services/DailyService';
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
