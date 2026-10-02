import { context, reddit, redis } from '@devvit/web/server';
import { isT3, type T3 } from '@devvit/web/shared';
import type { Difficulty } from '../../shared/discoveryApi';
import { levelFlairKey, levelPostKey, levelPostsKey } from './redisKeys';

// A level's difficulty as post flair, so the feed shows how hard it is
// before anyone opens it. An unrated level reads as NEW.
const FLAIR: Record<Difficulty, { text: string; backgroundColor: string; textColor: 'dark' | 'light' }> = {
  UNRATED: { text: 'NEW', backgroundColor: '#ffe66d', textColor: 'dark' },
  EASY: { text: 'EASY', backgroundColor: '#2e9d44', textColor: 'light' },
  NORMAL: { text: 'NORMAL', backgroundColor: '#3d6ea5', textColor: 'light' },
  HARD: { text: 'HARD', backgroundColor: '#ef7d1a', textColor: 'light' },
  CURSED: { text: 'CURSED', backgroundColor: '#e53935', textColor: 'light' },
  NIGHTMARE: { text: 'NIGHTMARE', backgroundColor: '#2b2b2b', textColor: 'light' },
};

async function flairPost(postId: T3, difficulty: Difficulty): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  await reddit.setPostFlair({ subredditName, postId, ...FLAIR[difficulty] });
}

// A new post for the level: remember it, and flair it right away.
export async function flairNewLevelPost(
  levelId: string,
  postId: T3,
  difficulty: Difficulty
): Promise<void> {
  try {
    await redis.zAdd(levelPostsKey(levelId), { member: postId, score: Date.now() });
    await flairPost(postId, difficulty);
    await redis.set(levelFlairKey(levelId), difficulty);
  } catch (error) {
    console.error(`Flair for new post ${postId} (${levelId}) failed`, error);
  }
}

// After a run: re-flair every post of the level, but only when its
// difficulty moved. Best-effort — the run already counted.
export async function syncLevelFlairSafely(
  levelId: string,
  difficulty: Difficulty
): Promise<void> {
  try {
    if ((await redis.get(levelFlairKey(levelId))) === difficulty) return;
    const [posts, canonical] = await Promise.all([
      redis.zRange(levelPostsKey(levelId), 0, -1, { by: 'rank' }),
      redis.get(levelPostKey(levelId)),
    ]);
    const ids = new Set(posts.map((entry) => entry.member));
    if (canonical) ids.add(canonical);
    // No posts (a level only reachable from Browse): nothing to flair yet.
    if (ids.size === 0) return;
    await redis.set(levelFlairKey(levelId), difficulty);
    await Promise.all(
      [...ids].map(async (id) => {
        if (!isT3(id)) return;
        try {
          await flairPost(id, difficulty);
        } catch (error) {
          console.error(`Re-flair of ${id} (${levelId}) failed`, error);
        }
      })
    );
  } catch (error) {
    console.error(`Flair sync for ${levelId} failed`, error);
  }
}
