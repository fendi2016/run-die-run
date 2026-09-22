import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { queueDiscoveryActivity } from '../services/DiscoveryService';
import { withTransaction } from '../core/transactions';
import {
  levelAttemptsKey,
  levelContributorKillsKey,
  levelVersionKey,
  runDedupeKey,
  trapKillsKey,
  userContributionsKey,
  versionLeaderboardKey,
} from '../core/redisKeys';
import { getCurrentLevelVersion } from '../services/LevelService';
import type {
  LeaderboardEntry,
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
  const dedupeKey = runDedupeKey(levelId, version, username, timeMs);
  const { personalBestMs, isNewPersonalBest } = await withTransaction(
    [leaderboardKey, dedupeKey],
    async (tx) => {
      // Two independent reads against unrelated keys — read both up front
      // instead of one after the other, saving a Redis round-trip on every
      // run submission.
      const [isDuplicate, existingScore] = await Promise.all([
        redis.exists(dedupeKey).then(Boolean),
        redis.zScore(leaderboardKey, username),
      ]);
      if (!isDuplicate) {
        await queueDiscoveryActivity(tx, levelId, username, true);
        await tx.set(dedupeKey, '1', {
          expiration: new Date(Date.now() + RUN_DEDUPE_TTL_MS),
        });
      }
      if (existingScore !== undefined && timeMs >= existingScore) {
        return {
          commit: !isDuplicate,
          value: { personalBestMs: existingScore, isNewPersonalBest: false },
        };
      }
      await tx.zAdd(leaderboardKey, { member: username, score: timeMs });
      return {
        commit: true,
        value: { personalBestMs: timeMs, isNewPersonalBest: true },
      };
    }
  );

  const [rankIndex, topTenRaw] = await Promise.all([
    redis.zRank(leaderboardKey, username),
    redis.zRange(leaderboardKey, 0, 9, { by: 'rank' }),
  ]);
  const rank = (rankIndex ?? 0) + 1;
  const topTen: LeaderboardEntry[] = topTenRaw.map((entry) => ({
    username: entry.member,
    timeMs: entry.score,
  }));
  const worldRecordMs = topTen[0]?.timeMs ?? personalBestMs;

  return c.json<SubmitRunResponse>({
    timeMs,
    rank,
    personalBestMs,
    isNewPersonalBest,
    worldRecordMs,
    topTen,
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
