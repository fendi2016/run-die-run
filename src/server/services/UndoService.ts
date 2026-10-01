import { redis } from '@devvit/web/server';
import { SEED_AUTHOR } from '../../shared/constants';
import { HAZARD_TYPES } from '../../shared/hazards';
import type { LevelObject, LevelVersion } from '../../shared/types';
import {
  levelCurrentVersionKey,
  levelRemovedTrapsKey,
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
  const removed = await removedTrapIds(levelId);
  // The version whose sabotage is in effect now (an undo copies an older one).
  let shown = await sabotageInEffect(levelId, current);
  let target: LevelVersion | undefined;
  for (;;) {
    if (!shown) return { status: 'error', message: 'Could not read this level’s history.' };
    if (shown.parentVersion === null) {
      return { status: 'error', message: 'Nothing to undo: this level has no sabotage.' };
    }
    target = await getLevelVersionAt(levelId, shown.parentVersion);
    if (!target) return { status: 'error', message: 'Could not read this level’s history.' };
    // A trap a moderator already removed by hand isn't in the level any
    // more: undo the sabotage before it instead.
    if (shown.addedObjectId === undefined || !removed.has(shown.addedObjectId)) break;
    shown = await sabotageInEffect(levelId, target);
  }

  const version = current.version + 1;
  const restored: LevelVersion = {
    levelId,
    version,
    parentVersion: current.version,
    objects: target.objects.filter((o) => !removed.has(o.id)),
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

async function sabotageInEffect(
  levelId: string,
  level: LevelVersion
): Promise<LevelVersion | undefined> {
  return level.restoredFrom === undefined ? level : getLevelVersionAt(levelId, level.restoredFrom);
}

async function removedTrapIds(levelId: string): Promise<Set<string>> {
  return new Set(Object.keys(await redis.hGetAll(levelRemovedTrapsKey(levelId))));
}

// A trap a player added by sabotage, after the level was published. Never
// the creator's own design (version 1) or a built-in level's traps.
export function isRemovableTrap(object: LevelObject): boolean {
  return HAZARD_TYPES.has(object.type) && object.addedInVersion > 1 && object.addedBy !== SEED_AUTHOR;
}

export async function listRemovableTraps(levelId: string): Promise<LevelObject[]> {
  const current = await getCurrentLevelVersion(levelId);
  return (current?.objects ?? []).filter(isRemovableTrap).sort((a, b) => a.x - b.x);
}

export type RemoveTrapResult =
  | { status: 'ok'; removedBy: string; removedType: string }
  | { status: 'error'; message: string };

// Moderator removal of one chosen player trap. Like an undo it's a new
// version (so it counts as one sabotage fewer), the owner gets that trap's
// slot back, and the id is remembered so a later undo never restores it.
export async function removeTrap(levelId: string, objectId: string): Promise<RemoveTrapResult> {
  const current = await getCurrentLevelVersion(levelId);
  if (!current) return { status: 'error', message: 'Could not find this level.' };
  const trap = current.objects.find((o) => o.id === objectId);
  if (!trap || !isRemovableTrap(trap)) {
    return { status: 'error', message: 'That trap is no longer in this level.' };
  }
  const version = current.version + 1;
  const next: LevelVersion = {
    ...current,
    version,
    parentVersion: current.version,
    objects: current.objects.filter((o) => o.id !== objectId),
    createdAt: Date.now(),
    // The sabotage in effect (and its author) doesn't change.
    restoredFrom: current.restoredFrom ?? current.version,
  };
  const committed = await withTransaction(
    [levelCurrentVersionKey(levelId), levelVersionKey(levelId, version)],
    async (tx) => {
      if (Number(await redis.get(levelCurrentVersionKey(levelId))) !== current.version) {
        return { commit: false, value: false };
      }
      await tx.set(levelVersionKey(levelId, version), JSON.stringify(next));
      await tx.set(levelCurrentVersionKey(levelId), String(version));
      await tx.incrBy(levelUndosKey(levelId), 1);
      await tx.hSet(levelRemovedTrapsKey(levelId), { [objectId]: '1' });
      await tx.hDel(userCursesKey(trap.addedBy), [objectId]);
      await tx.hDel(userCursesSeenKey(trap.addedBy), [objectId]);
      return { commit: true, value: true };
    }
  );
  if (!committed) {
    return { status: 'error', message: 'Someone just changed this level. Try again.' };
  }
  await refreshDiscoveryIndexSafely(levelId);
  return { status: 'ok', removedBy: trap.addedBy, removedType: trap.type };
}
