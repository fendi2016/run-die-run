import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const follow = new Hono();

// Subscribes the signed-in user to the subreddit this app is running in
// (the "Follow r/X" button on the death panel). Runs as the user, not the
// app account, so it needs SUBSCRIBE_TO_SUBREDDIT in devvit.json's
// permissions.reddit.asUser.
follow.post('/', async (c) => {
  const { username, subredditName } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to follow' },
      401
    );
  }

  try {
    await reddit.subscribeToCurrentSubreddit();
  } catch {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Could not follow subreddit' },
      500
    );
  }

  return c.json({ subscribed: true as const, subredditName });
});
