import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import {
  isDraftObject,
  type PublishLevelRequest,
  type PublishLevelResponse,
  type ValidateLevelRequest,
  type ValidateLevelResponse,
  type VerifyLevelRequest,
  type VerifyLevelResponse,
} from '../../shared/editorApi';
import { SEED_LEVELS } from '../core/seedLevels';
import { withTransaction } from '../core/transactions';
import type { LevelObject, LevelVersion } from '../../shared/types';
import {
  allLevelsByDateKey,
  editorCandidateKey,
  levelCurrentVersionKey,
  levelMetaKey,
  levelVersionKey,
  userCreatedLevelsKey,
} from '../core/redisKeys';
import {
  canonicalizeObjects,
  createCandidate,
  getCandidate,
  isVerifiedCandidate,
  markCandidateVerified,
  validatePlacement,
} from '../services/VerificationService';

type ErrorResponse = {
  status: 'error';
  message: string;
};

// Sanity bound only, not real anti-cheat (spec section 36: build reasonable
// server authority first, don't spend weeks on anti-cheat before the core
// game is proven) — matches runs.ts's own bound for a submitted time.
const MAX_REASONABLE_TIME_MS = 10 * 60 * 1000;
const MAX_TITLE_LENGTH = 60;

// Shared by the slug-uniqueness loop's cheap pre-check and the
// transaction's own authoritative re-check below it — both need the exact
// same "does anything already exist at this level id" test.
async function levelIdTaken(levelId: string): Promise<boolean> {
  return Boolean(
    await redis.exists(
      levelMetaKey(levelId),
      levelCurrentVersionKey(levelId),
      levelVersionKey(levelId, 1)
    )
  );
}

function isValidateBody(body: unknown): body is ValidateLevelRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'objects' in body &&
    Array.isArray(body.objects) &&
    body.objects.every(isDraftObject)
  );
}

function isVerifyBody(body: unknown): body is VerifyLevelRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'candidateToken' in body &&
    typeof body.candidateToken === 'string' &&
    body.candidateToken.length > 0 &&
    'timeMs' in body &&
    typeof body.timeMs === 'number' &&
    Number.isFinite(body.timeMs) &&
    body.timeMs > 0 &&
    body.timeMs <= MAX_REASONABLE_TIME_MS
  );
}

function isPublishBody(body: unknown): body is PublishLevelRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'candidateToken' in body &&
    typeof body.candidateToken === 'string' &&
    body.candidateToken.length > 0 &&
    'title' in body &&
    typeof body.title === 'string' &&
    body.title.trim().length > 0 &&
    'objects' in body &&
    Array.isArray(body.objects) &&
    body.objects.every(isDraftObject)
  );
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base.length > 0 ? base.slice(0, 40) : 'level';
}

export const publish = new Hono();

publish.post('/validate', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to test a level' },
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
  if (!isValidateBody(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid level data' },
      400
    );
  }

  const errors = validatePlacement(body.objects);
  if (errors.length > 0) {
    return c.json<ValidateLevelResponse>({ status: 'error', errors });
  }

  const candidateToken = await createCandidate(username, body.objects);
  return c.json<ValidateLevelResponse>({ status: 'ok', candidateToken });
});

publish.post('/verify', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to verify a level' },
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
  if (!isVerifyBody(body)) {
    return c.json<VerifyLevelResponse>(
      { status: 'error', message: 'Invalid verification request' },
      400
    );
  }

  const verified = await markCandidateVerified(
    username,
    body.candidateToken,
    body.timeMs
  );
  if (!verified) {
    return c.json<VerifyLevelResponse>(
      {
        status: 'error',
        message: 'No matching test session found — press Test again.',
      },
      400
    );
  }

  return c.json<VerifyLevelResponse>({ status: 'ok' });
});

publish.post('/publish', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to publish a level' },
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
  if (!isPublishBody(body)) {
    return c.json<PublishLevelResponse>(
      { status: 'error', message: 'Invalid publish request' },
      400
    );
  }

  const candidate = await getCandidate(username);
  if (!isVerifiedCandidate(candidate, 'create', body.candidateToken)) {
    return c.json<PublishLevelResponse>(
      {
        status: 'error',
        message: 'This level has not been verified — beat it via Test first.',
      },
      400
    );
  }

  // The candidate configuration used for verification must be exactly the
  // configuration published (spec section 20) — re-check even though the
  // client already sent matching objects at /validate time, since the
  // creator could have kept editing after the test run finished.
  if (
    canonicalizeObjects(candidate.objects) !== canonicalizeObjects(body.objects)
  ) {
    return c.json<PublishLevelResponse>(
      {
        status: 'error',
        message: 'Level changed since it was verified — press Test again.',
      },
      400
    );
  }

  const errors = validatePlacement(body.objects);
  if (errors.length > 0) {
    return c.json<PublishLevelResponse>(
      { status: 'error', message: errors[0] ?? 'Invalid level' },
      400
    );
  }

  const slug = slugify(body.title);
  const createdAt = Date.now();
  const objects: LevelObject[] = body.objects.map((o) => ({
    id: randomUUID(),
    type: o.type,
    x: o.x,
    y: o.y,
    properties: {},
    addedBy: username,
    addedInVersion: 1,
  }));

  const levelVersion: LevelVersion = {
    levelId: slug,
    version: 1,
    parentVersion: null,
    objects,
    contributorUsername: username,
    verificationTimeMs: candidate.verifiedTimeMs,
    createdAt,
  };

  const title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
  for (let suffix = 1; suffix <= 100; suffix++) {
    const levelId = suffix === 1 ? slug : `${slug}-${suffix}`;
    // Reserve seed IDs even before their first lazy initialization.
    if (Object.hasOwn(SEED_LEVELS, levelId)) continue;
    // A cheap plain EXISTS first, before paying for a full WATCH/MULTI/EXEC
    // transaction — under contention (many creators titling levels "Level
    // 1"), most suffixes in this loop are already taken, and opening a
    // full transaction just to discover that turns a busy id-space into a
    // multi-hundred-ms tail-latency spike. The transaction below still
    // re-checks existence itself (structurally required — a pre-WATCH read
    // can't be relied on to reflect state at watch time), so this pre-check
    // only ever skips work, it never weakens the race safety.
    if (await levelIdTaken(levelId)) {
      continue;
    }
    const result = await withTransaction<PublishLevelResponse | undefined>(
      [
        levelMetaKey(levelId),
        levelCurrentVersionKey(levelId),
        levelVersionKey(levelId, 1),
        editorCandidateKey(username),
      ],
      async (tx) => {
        const current = await getCandidate(username);
        if (
          !current ||
          current.token !== candidate.token ||
          !current.verified
        ) {
          return {
            commit: false,
            value: {
              status: 'error',
              message: 'Test session changed — press Test again.',
            },
          };
        }
        if (await levelIdTaken(levelId)) {
          return { commit: false, value: undefined };
        }
        await tx.set(
          levelVersionKey(levelId, 1),
          JSON.stringify({ ...levelVersion, levelId })
        );
        await tx.set(levelCurrentVersionKey(levelId), '1');
        await tx.set(
          levelMetaKey(levelId),
          JSON.stringify({ title, creatorUsername: username, createdAt })
        );
        await tx.zAdd(userCreatedLevelsKey(username), {
          member: levelId,
          score: createdAt,
        });
        await tx.zAdd(allLevelsByDateKey(), {
          member: levelId,
          score: createdAt,
        });
        await tx.del(editorCandidateKey(username));
        return { commit: true, value: { status: 'ok', levelId, version: 1 } };
      }
    );
    if (result)
      return c.json<PublishLevelResponse>(
        result,
        result.status === 'ok' ? 200 : 409
      );
  }
  return c.json<PublishLevelResponse>(
    { status: 'error', message: 'Please choose a different level title.' },
    409
  );
});
