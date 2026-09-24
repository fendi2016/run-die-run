import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
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
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
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
