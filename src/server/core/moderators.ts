import { context, reddit } from '@devvit/web/server';

// Whether the player making this request moderates the subreddit.
export async function isModerator(): Promise<boolean> {
  const { username, subredditName } = context;
  if (!username || !subredditName) return false;
  const mods = await reddit.getModerators({ subredditName, username }).all();
  return mods.some((mod) => mod.username.toLowerCase() === username.toLowerCase());
}
