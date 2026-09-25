import { context, reddit } from '@devvit/web/server';
import { labelFor } from '../../shared/objectLabels';
import type { ObjectType } from '../../shared/types';
import { getLevelStats } from '../services/DiscoveryService';
import { getLevelPostId } from './post';

// Everything here is Reddit-facing side output of an already-committed
// write (a curse). Each call is best-effort: it logs and returns
// on any failure, never throwing into the route that triggered it.

// A curse becomes a comment on the level's thread (its canonical post, or
// the post the curse was made from if the level has none yet) — every
// curse bumps the post and leaves a public trail of who made it harder.
export async function announceCurse(opts: {
  levelId: string;
  version: number;
  username: string;
  addedType: ObjectType;
  removedPlatform: boolean;
  extended: boolean;
}): Promise<void> {
  try {
    const postId = (await getLevelPostId(opts.levelId)) ?? context.postId;
    if (!postId) return;
    const stats = await getLevelStats(opts.levelId);
    const title = stats?.title ?? opts.levelId;
    const extras = [
      opts.removedPlatform ? 'ripped out a platform' : undefined,
      opts.extended ? 'made the level longer' : undefined,
    ].filter((extra) => extra !== undefined);
    const did = [`added a **${labelFor(opts.addedType)}**`, ...extras].join(' and ');
    await reddit.submitComment({
      id: postId,
      text: `🩸 **u/${opts.username}** cursed **"${title}"** (curse #${opts.version - 1}): ${did}. They beat it first, so it's still possible. Can you?`,
      runAs: 'APP',
    });
  } catch (error) {
    console.error(`Curse comment failed for ${opts.levelId} v${opts.version}: ${error}`);
  }
}
