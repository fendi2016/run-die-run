import { redis } from '@devvit/web/server';
import type { LevelVersion } from '../../shared/types';
import {
  levelCurrentVersionKey,
  levelUndosKey,
  levelVersionKey,
  userCursesKey,
  userCursesSeenKey,
} from '../core/redisKeys';
import { withTransaction } from '../core/transactions';
import { refreshDiscoveryIndexSafely } from './DiscoveryService';
import { getCurrentLevelVersion, getLevelVersionAt } from './LevelService';

export type UndoSabotageResult =
  | { status: 'ok'; version: number; undoneBy: string; undoneType: string | undefined }
  | { status: 'error'; message: string };

// Moderator undo of a level's latest sabotage, for a level that got too
// hard for anyone to beat. Versions only ever move forward: the undo is a
// new version holding a copy of the level as it was before that sabotage,
// so per-version records, skulls and cleared-version streaks never collide
// with a later sabotage reusing an old version number. Undoing again steps
// back one more sabotage.
export async function undoLatestSabotage(levelId: string): Promise<UndoSabotageResult> {
  const current = await getCurrentLevelVersion(levelId);
  if (!current) return { status: 'error', message: 'Could not find this level.' };
  // The version whose sabotage is in effect now (an undo copies an older one).
  const shown =
    current.restoredFrom === undefined
      ? current
      : await getLevelVersionAt(levelId, current.restoredFrom);
  if (!shown) return { status: 'error', message: 'Could not read this level’s history.' };
  if (shown.parentVersion === null) {
    return { status: 'error', message: 'Nothing to undo: this level has no sabotage.' };
  }
  const target = await getLevelVersionAt(levelId, shown.parentVersion);
  if (!target) return { status: 'error', message: 'Could not read this level’s history.' };

  const version = current.version + 1;
  const restored: LevelVersion = {
    levelId,
    version,
    parentVersion: current.version,
    objects: target.objects,
    contributorUsername: target.contributorUsername,
    ...(target.addedObjectId === undefined ? {} : { addedObjectId: target.addedObjectId }),
    verificationTimeMs: target.verificationTimeMs,
    createdAt: Date.now(),
    restoredFrom: target.restoredFrom ?? target.version,
  };
  const committed = await withTransaction(
    [levelCurrentVersionKey(levelId), levelVersionKey(levelId, version)],
    async (tx) => {
      // A sabotage published since the read above: the mod should look again.
      if (Number(await redis.get(levelCurrentVersionKey(levelId))) !== current.version) {
        return { commit: false, value: false };
      }
      await tx.set(levelVersionKey(levelId, version), JSON.stringify(restored));
      await tx.set(levelCurrentVersionKey(levelId), String(version));
      await tx.incrBy(levelUndosKey(levelId), 1);
      // As if it was never placed: off the player's "Your sabotage" list,
      // and no longer one of their CURSES_PER_LEVEL on this level.
      if (shown.addedObjectId !== undefined) {
        await tx.hDel(userCursesKey(shown.contributorUsername), [shown.addedObjectId]);
        await tx.hDel(userCursesSeenKey(shown.contributorUsername), [shown.addedObjectId]);
      }
      return { commit: true, value: true };
    }
  );
  if (!committed) {
    return { status: 'error', message: 'Someone just sabotaged this level. Try again.' };
  }
  await refreshDiscoveryIndexSafely(levelId);
  return {
    status: 'ok',
    version,
    undoneBy: shown.contributorUsername,
    undoneType: shown.objects.find((o) => o.id === shown.addedObjectId)?.type,
  };
}
