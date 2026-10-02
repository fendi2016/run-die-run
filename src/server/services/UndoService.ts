import { redis } from '@devvit/web/server';
import { isPlayerTrap, isTrapInStartZone, PLAYER_TRAP_LIFETIME_MS } from '../../shared/editorApi';
import type { LevelObject, LevelVersion } from '../../shared/types';
import {
  allLevelsByDateKey,
  levelCurrentVersionKey,
  levelRemovedTrapsKey,
  levelUndosKey,
  levelVersionKey,
  trapExpiryCursorKey,
  userCursesKey,
  userCursesSeenKey,
} from '../core/redisKeys';
import { SEED_LEVELS } from '../core/seedLevels';
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

export async function listRemovableTraps(levelId: string): Promise<LevelObject[]> {
  const current = await getCurrentLevelVersion(levelId);
  return (current?.objects ?? []).filter(isPlayerTrap).sort((a, b) => a.x - b.x);
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
  if (!trap || !isPlayerTrap(trap)) {
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

// Every level that can hold player traps: the built-ins plus every
// published level.
async function allLevelIds(): Promise<string[]> {
  const indexed = await redis.zRange(allLevelsByDateKey(), 0, -1, { by: 'rank' });
  return [...new Set([...Object.keys(SEED_LEVELS), ...indexed.map((e) => e.member)])];
}

// Removes, one by one like removeTrap, every player trap `matches` picks on
// every level. Returns how many it removed and how many it couldn't
// (someone changed the level mid-way, or a level errored; the next run gets
// them). With `resume`, the walk starts where the last run stopped and ends
// early once the time budget is spent, saving where it got to — so a long
// level list is covered over several runs instead of the same tail being
// cut off every time.
async function removeTrapsEverywhere(
  matches: (levelId: string, traps: LevelObject[]) => Promise<LevelObject[]>,
  resume?: { cursorKey: string; budgetMs: number }
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  const levelIds = await allLevelIds();
  const start = resume ? Number(await redis.get(resume.cursorKey)) || 0 : 0;
  const first = start < levelIds.length ? start : 0;
  const deadline = resume ? Date.now() + resume.budgetMs : Infinity;
  for (let step = 0; step < levelIds.length; step++) {
    const index = (first + step) % levelIds.length;
    if (Date.now() >= deadline) {
      if (resume) await redis.set(resume.cursorKey, String(index));
      return { removed, failed };
    }
    const levelId = levelIds[index];
    if (levelId === undefined) continue;
    try {
      const traps = await listRemovableTraps(levelId);
      if (traps.length === 0) continue;
      for (const trap of await matches(levelId, traps)) {
        if ((await removeTrap(levelId, trap.id)).status === 'ok') removed += 1;
        else failed += 1;
      }
    } catch (error) {
      console.error(`Trap cleanup failed on level ${levelId}: ${error}`);
      failed += 1;
    }
  }
  if (resume) await redis.set(resume.cursorKey, '0');
  return { removed, failed };
}

// Moderator cleanup for traps placed before the start-zone rule existed:
// every player trap in the first TRAP_FREE_START_CELLS columns.
export async function removeStartZoneTraps(): Promise<{ removed: number; failed: number }> {
  return removeTrapsEverywhere(async (_levelId, traps) =>
    traps.filter((trap) => isTrapInStartZone(trap.type, trap.x))
  );
}

// Scheduled job: player traps older than PLAYER_TRAP_LIFETIME_MS leave the
// level (their owner gets the slot back), so no level only ever piles up.
// A trap's age is that of the version that placed it. Each run stops after
// TRAP_EXPIRY_BUDGET_MS, well inside a request's time limit, and the next
// one carries on from there.
const TRAP_EXPIRY_BUDGET_MS = 20_000;

export async function expireOldTraps(now = Date.now()): Promise<{ removed: number; failed: number }> {
  return removeTrapsEverywhere(async (levelId, traps) => {
    const expired: LevelObject[] = [];
    const placedAt = new Map<number, number | undefined>();
    for (const trap of traps) {
      if (!placedAt.has(trap.addedInVersion)) {
        placedAt.set(trap.addedInVersion, (await getLevelVersionAt(levelId, trap.addedInVersion))?.createdAt);
      }
      const at = placedAt.get(trap.addedInVersion);
      if (at !== undefined && now - at >= PLAYER_TRAP_LIFETIME_MS) expired.push(trap);
    }
    return expired;
  }, { cursorKey: trapExpiryCursorKey(), budgetMs: TRAP_EXPIRY_BUDGET_MS });
}
