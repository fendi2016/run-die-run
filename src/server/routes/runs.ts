import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { context, realtime, redis } from '@devvit/web/server';
import { CURRENCY_PER_CLEAR } from '../../shared/constants';
import { levelRealtimeChannel, type NewWorldRecordEvent } from '../../shared/realtimeApi';
import { queueDiscoveryActivity } from '../services/DiscoveryService';
import { withTransaction } from '../core/transactions';
import {
  clearedVersionsKey,
  currencyKey,
  levelAttemptsKey,
  levelContributorKillsKey,
  levelVersionKey,
  runDedupeKey,
  runSubmissionKey,
  streaksLeaderboardKey,
  topCursersKey,
  trapKillsKey,
  userContributionsKey,
  userStatsKey,
  versionLeaderboardKey,
} from '../core/redisKeys';
import { getCurrentLevelVersion } from '../services/LevelService';
import type {
  SubmitRunRequest,
  SubmitRunResponse,
  TrapKillRequest,
  TrapKillResponse,
} from '../../shared/runsApi';

type ErrorResponse = {
  status: 'error';
  message: string;
};

// Sanity bound only, not real anti-cheat (spec section 36: build reasonable
// server authority first, don't spend weeks on anti-cheat before the core
// game is proven).
const MAX_REASONABLE_TIME_MS = 10 * 60 * 1000;
// How long a duplicate submission of the exact same (level, version,
// player, time) is suppressed from double-counting Discovery's
// attempt/clear stats — long enough to cover a client retrying a
// timed-out/network-interrupted request, short enough that it can never
// suppress a later, genuinely different run that happens to tie exactly.
const RUN_DEDUPE_TTL_MS = 2 * 60 * 1000;

function isValidSubmission(body: unknown): body is SubmitRunRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (!('submissionId' in body) ||
      (typeof body.submissionId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(body.submissionId))) &&
    'levelId' in body &&
    typeof body.levelId === 'string' &&
    body.levelId.length > 0 &&
    'version' in body &&
    typeof body.version === 'number' &&
    Number.isInteger(body.version) &&
    body.version >= 1 &&
    'timeMs' in body &&
    typeof body.timeMs === 'number' &&
    Number.isFinite(body.timeMs) &&
    body.timeMs > 0 &&
    body.timeMs <= MAX_REASONABLE_TIME_MS
  );
}

function isTrapKillBody(body: unknown): body is TrapKillRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'levelId' in body &&
    typeof body.levelId === 'string' &&
    body.levelId.length > 0 &&
    'version' in body &&
    typeof body.version === 'number' &&
    Number.isInteger(body.version) &&
    body.version >= 1 &&
    'objectId' in body &&
    typeof body.objectId === 'string' &&
    body.objectId.length > 0
  );
}

export const runs = new Hono();

runs.post('/', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to submit a run' },
      401
    );
  }

  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid request body' },
      400
    );
  }

  if (!isValidSubmission(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid run submission' },
      400
    );
  }
  const { levelId, version, timeMs } = body;

  const published = await getCurrentLevelVersion(levelId);
  if (
    !published ||
    version > published.version ||
    !(await redis.exists(levelVersionKey(levelId, version)))
  ) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Unknown published version' },
      404
    );
  }

  const leaderboardKey = versionLeaderboardKey(levelId, version);
  // The leaderboard write below is already naturally idempotent (a
  // repeated submission with the same/worse time just no-ops), but
  // `queueDiscoveryActivity`'s attempt/clear counters aren't — a retried
  // POST for a run that already succeeded would otherwise double-count.
  const dedupeKey = body.submissionId
    ? runSubmissionKey(username, body.submissionId)
    : runDedupeKey(levelId, version, username, timeMs);
  const fingerprint = JSON.stringify({ levelId, version, timeMs });
  const clearedKey = clearedVersionsKey(username);
  const clearField = `${levelId}:${version}`;
  const currencyBalanceKey = currencyKey(username);
  const streaksKey = streaksLeaderboardKey();

  const {
    isNewWorldRecord,
    streak,
    isNewStreakIncrease,
    currencyAwarded,
    currencyBalance,
  } = await withTransaction(
    [leaderboardKey, dedupeKey, clearedKey, currencyBalanceKey, streaksKey],
    async (tx) => {
      // Independent reads against unrelated keys — read them all up front
      // instead of one after the other, saving Redis round-trips on every
      // run submission.
      const [
        previousSubmission,
        existingScore,
        previousWorldRecordTop,
        alreadyCleared,
        currentStreak,
        currentCurrency,
      ] = await Promise.all([
        redis.get(dedupeKey),
        redis.zScore(leaderboardKey, username),
        redis.zRange(leaderboardKey, 0, 0, { by: 'rank' }),
        redis.hGet(clearedKey, clearField).then((value) => value !== undefined),
        redis.hLen(clearedKey),
        redis.get(currencyBalanceKey),
      ]);
      const isDuplicate = previousSubmission !== undefined;
      if (body.submissionId && isDuplicate && previousSubmission !== fingerprint) {
        throw new HTTPException(409, { message: 'Submission ID already belongs to another clear' });
      }
      const previousWorldRecordMs = previousWorldRecordTop[0]?.score;

      if (!isDuplicate) {
        await queueDiscoveryActivity(tx, levelId, username, true);
        await tx.hIncrBy(userStatsKey(username), 'totalClears', 1);
        if (body.submissionId) {
          await tx.set(dedupeKey, fingerprint);
        } else {
          await tx.set(dedupeKey, '1', {
            expiration: new Date(Date.now() + RUN_DEDUPE_TTL_MS),
          });
        }
      }

      // Flat currency per non-duplicate clear (no shop to balance a curve
      // against yet — see shared/constants.ts), regardless of whether this
      // version was already cleared before or beats a personal best.
      const currencyAwarded = isDuplicate ? 0 : CURRENCY_PER_CLEAR;
      if (currencyAwarded > 0) {
        await tx.incrBy(currencyBalanceKey, currencyAwarded);
      }
      const currencyBalance = Number(currentCurrency ?? 0) + currencyAwarded;

      // Clear Streaks (spec section 28): a lifetime count of unique
      // (levelId, version) pairs cleared, never reset — only grows the
      // first time a given version is cleared, a replay is a no-op.
      const isNewStreakIncrease = !isDuplicate && !alreadyCleared;
      const streak = currentStreak + (isNewStreakIncrease ? 1 : 0);
      if (isNewStreakIncrease) {
        await tx.hSet(clearedKey, { [clearField]: '1' });
        await tx.zAdd(streaksKey, { member: username, score: streak });
      }

      if (existingScore !== undefined && timeMs >= existingScore) {
        return {
          commit: !isDuplicate,
          value: {
            isNewWorldRecord: false,
            streak,
            isNewStreakIncrease,
            currencyAwarded,
            currencyBalance,
          },
        };
      }
      await tx.zAdd(leaderboardKey, { member: username, score: timeMs });
      return {
        commit: true,
        value: {
          isNewWorldRecord:
            !isDuplicate &&
            (previousWorldRecordMs === undefined || timeMs < previousWorldRecordMs),
          streak,
          isNewStreakIncrease,
          currencyAwarded,
          currencyBalance,
        },
      };
    }
  );

  if (isNewWorldRecord) {
    const event: NewWorldRecordEvent = {
      type: 'newWorldRecord',
      levelId,
      username,
      timeMs,
    };
    // Best-effort: a dropped realtime notice never invalidates a real,
    // already-committed run submission.
    await realtime.send(levelRealtimeChannel(levelId), event).catch(() => undefined);
  }

  return c.json<SubmitRunResponse>({
    timeMs,
    streak,
    isNewStreakIncrease,
    currencyAwarded,
    currencyBalance,
  });
});

// Fired without blocking the death/restart loop (spec section 30 forbids a
// network call gating the instant respawn) — the client already shows "who
// killed you" instantly from its own loaded level data, this only grows
// the server-authoritative kill counters (spec section 23).
runs.post('/trap-kill', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to report a death' },
      401
    );
  }

  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid request body' },
      400
    );
  }
  if (!isTrapKillBody(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid trap-kill report' },
      400
    );
  }

  // Looked up by id in the CURRENT version rather than gated on the
  // reported version matching exactly — curse publishes only ever append
  // objects (spec section 17: versions are immutable, never edited), so an
  // object placed in an earlier version is still present, at the same id,
  // in every version after it. Requiring an exact version match would
  // silently drop legitimate attribution any time a curse landed while
  // this run was in flight.
  const level = await getCurrentLevelVersion(body.levelId);
  const object = level?.objects.find((o) => o.id === body.objectId);
  if (!object) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Unknown trap' },
      404
    );
  }

  // All four counters commit as one atomic unit — previously the trap/
  // contributor counters were three separate un-transacted calls after
  // the discovery-activity transaction had already closed, so an
  // interruption between them could leave the per-object kill count and
  // the contributor's cross-level aggregate permanently out of sync.
  const trapKey = trapKillsKey(object.id);
  const contributorKey = userContributionsKey(object.addedBy);
  const { kills, contributorTotalKills } = await withTransaction(
    [
      levelAttemptsKey(body.levelId),
      trapKey,
      contributorKey,
      levelContributorKillsKey(body.levelId),
      topCursersKey(),
    ],
    async (tx) => {
      await queueDiscoveryActivity(tx, body.levelId, username, false);
      const [currentKills, currentContributorTotal] = await Promise.all([
        redis.get(trapKey),
        redis.get(contributorKey),
      ]);
      const kills = Number(currentKills ?? 0) + 1;
      const contributorTotalKills = Number(currentContributorTotal ?? 0) + 1;
      await tx.incrBy(trapKey, 1);
      await tx.incrBy(contributorKey, 1);
      await tx.zIncrBy(levelContributorKillsKey(body.levelId), object.addedBy, 1);
      await tx.zIncrBy(topCursersKey(), object.addedBy, 1);
      return { commit: true, value: { kills, contributorTotalKills } };
    }
  );

  return c.json<TrapKillResponse>({
    objectId: object.id,
    kills,
    addedBy: object.addedBy,
    contributorTotalKills,
  });
});
