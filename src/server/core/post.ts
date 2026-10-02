import { context, reddit, redis } from '@devvit/web/server';
import { isT3, type T3 } from '@devvit/web/shared';
import { SEED_AUTHOR } from '../../shared/constants';
import type { SketchyPostData } from '../../shared/postData';
import type { Difficulty } from '../../shared/discoveryApi';
import { flairNewLevelPost } from './postFlair';
import { levelPostKey } from './redisKeys';

type CreatedPost = { id: T3; url: string };

const postUrl = (id: T3): string =>
  `https://reddit.com/r/${context.subredditName}/comments/${id}`;

// The hub post (install / mod menu): no postData, so it plays the default
// level and leads with Play / Build / Browse.
export async function createHubPost(): Promise<CreatedPost> {
  const post = await reddit.submitCustomPost({
    title: 'SKETCHY — beat the level, then sabotage it for the next player',
    textFallback: {
      text: 'SKETCHY is a Reddit platformer where every player who beats a level can add one trap to it. Open this post on new Reddit or the app to play.',
    },
  });
  return { id: post.id, url: postUrl(post.id) };
}

// One post per level: this is what puts a creator's level in the feed.
// Also used by the daily scheduler (`daily` set), which reposts an existing
// level, titled with just the level's name — the first post ever made for
// a level becomes its canonical thread (curse comments go there), later
// ones never replace it.
//
// `asCreator` (a player's publish) posts from the player's own account, so
// the post, its karma and its reply notifications are theirs. If Reddit
// refuses that, it falls back to an app post that credits them by name.
export async function createLevelPost(opts: {
  levelId: string;
  title: string;
  creatorUsername: string;
  difficulty: Difficulty;
  daily?: number;
  asCreator?: boolean;
}): Promise<CreatedPost> {
  const byline =
    opts.creatorUsername === SEED_AUTHOR
      ? 'a SKETCHY original'
      : `by u/${opts.creatorUsername}`;
  const postData: SketchyPostData =
    opts.daily !== undefined
      ? { levelId: opts.levelId, daily: opts.daily }
      : { levelId: opts.levelId };
  const fallbackText = `"${opts.title}" is a SKETCHY level ${byline}. Beat it, then sabotage it with a trap of your own. Open this post on new Reddit or the app to play.`;

  const post = await (async () => {
    if (opts.asCreator) {
      try {
        return await reddit.submitCustomPost({
          title: `"${opts.title}" — can you beat it?`,
          postData,
          runAs: 'USER',
          userGeneratedContent: { text: opts.title },
          textFallback: { text: fallbackText },
        });
      } catch (error) {
        console.error(`Posting ${opts.levelId} as u/${opts.creatorUsername} failed; posting as the app`, error);
      }
    }
    return reddit.submitCustomPost({
      title:
        opts.daily !== undefined
          ? opts.title
          : `"${opts.title}" ${byline} — can you beat it?`,
      postData,
      textFallback: { text: fallbackText },
    });
  })();
  await redis.set(levelPostKey(opts.levelId), post.id, { nx: true });
  await flairNewLevelPost(opts.levelId, post.id, opts.difficulty);
  return { id: post.id, url: postUrl(post.id) };
}

export async function getLevelPostId(levelId: string): Promise<T3 | undefined> {
  const id = await redis.get(levelPostKey(levelId));
  return isT3(id) ? id : undefined;
}
