import { context, reddit, redis } from '@devvit/web/server';
import { isT3, type T3 } from '@devvit/web/shared';
import { SEED_AUTHOR } from '../../shared/constants';
import type { CursedPostData } from '../../shared/postData';
import { levelPostKey } from './redisKeys';

type CreatedPost = { id: T3; url: string };

const postUrl = (id: T3): string =>
  `https://reddit.com/r/${context.subredditName}/comments/${id}`;

// The hub post (install / mod menu): no postData, so it plays the default
// level and leads with Play / Build / Browse.
export async function createHubPost(): Promise<CreatedPost> {
  const post = await reddit.submitCustomPost({
    title: 'CURSED — beat the level, then curse it for the next player',
    textFallback: {
      text: 'CURSED is a Reddit platformer where every player who beats a level can add one trap to it. Open this post on new Reddit or the app to play.',
    },
  });
  return { id: post.id, url: postUrl(post.id) };
}

// One post per level: this is what puts a creator's level in the feed.
// Also used by the daily scheduler (`daily` set), which reposts an existing
// level — the first post ever made for a level becomes its canonical
// thread (curse comments go there), later ones never replace it.
export async function createLevelPost(opts: {
  levelId: string;
  title: string;
  creatorUsername: string;
  daily?: number;
}): Promise<CreatedPost> {
  const byline =
    opts.creatorUsername === SEED_AUTHOR
      ? 'a CURSED original'
      : `by u/${opts.creatorUsername}`;
  const title =
    opts.daily !== undefined
      ? `Cursed Level of the Day #${opts.daily}: "${opts.title}" ${byline}`
      : `"${opts.title}" ${byline} — can you beat it?`;
  const postData: CursedPostData =
    opts.daily !== undefined
      ? { levelId: opts.levelId, daily: opts.daily }
      : { levelId: opts.levelId };

  const post = await reddit.submitCustomPost({
    title,
    postData,
    textFallback: {
      text: `"${opts.title}" is a CURSED level ${byline}. Beat it, then curse it with a trap of your own. Open this post on new Reddit or the app to play.`,
    },
  });
  await redis.set(levelPostKey(opts.levelId), post.id, { nx: true });
  return { id: post.id, url: postUrl(post.id) };
}

export async function getLevelPostId(levelId: string): Promise<T3 | undefined> {
  const id = await redis.get(levelPostKey(levelId));
  return isT3(id) ? id : undefined;
}
