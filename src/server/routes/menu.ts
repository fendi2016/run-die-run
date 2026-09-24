import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { createHubPost } from '../core/post';
import { postLevelOfTheDay } from '../services/DailyService';
import { reseedBuiltInLevels } from '../services/LevelService';

export const menu = new Hono();

// Dev utility (see LevelService.reseedBuiltInLevels): a source edit to a
// seed level in seedLevels.ts never reaches a subreddit where that level
// was already requested once, since levels only seed on first request.
// This forces the three built-in levels' stored data back in sync with
// whatever seedLevels.ts currently says, without touching any real
// published level.
menu.post('/reseed-levels', async (c) => {
  try {
    const levelIds = await reseedBuiltInLevels();
    return c.json<UiResponse>(
      { showToast: `Reseeded: ${levelIds.join(', ')}` },
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
