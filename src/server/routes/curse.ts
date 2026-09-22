import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import {
  CURSE_CATEGORY_TYPES,
  isDraftObject,
  type DraftObject,
  type ProposeCurseResponse,
  type PublishCurseResponse,
} from '../../shared/editorApi';
import type { LevelObject, LevelVersion } from '../../shared/types';
import {
  editorCandidateKey,
  levelCurrentVersionKey,
  levelVersionKey,
} from '../core/redisKeys';
import { withTransaction } from '../core/transactions';
import { getCurrentLevelVersion } from '../services/LevelService';
import {
  createCurseCandidate,
  getCandidate,
  isVerifiedCandidate,
  validatePlacement,
} from '../services/VerificationService';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const CURSE_TYPES = new Set(Object.values(CURSE_CATEGORY_TYPES).flat());

function isProposeCurseBody(
  value: unknown
): value is { levelId: string; object: DraftObject } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    value.levelId.length > 0 &&
    'object' in value &&
    isDraftObject(value.object)
  );
}

function isPublishCurseBody(
  value: unknown
): value is { candidateToken: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'candidateToken' in value &&
    typeof value.candidateToken === 'string' &&
    value.candidateToken.length > 0
  );
}

export const curse = new Hono();

// The curse UI (spec sections 14-15) is a deliberately smaller component
// than the base editor: exactly one new object, chosen from a restricted
// category set, added on top of an existing published configuration it
// cannot otherwise touch.
curse.post('/propose', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to curse a level' },
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
  if (!isProposeCurseBody(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid curse request' },
      400
    );
  }
  if (!CURSE_TYPES.has(body.object.type)) {
    return c.json<ProposeCurseResponse>({
      status: 'error',
      errors: ['That object type cannot be used to curse a level.'],
    });
  }

  const current = await getCurrentLevelVersion(body.levelId);
  if (!current) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Level not found' },
      404
    );
  }

  // The id is server-generated, never trusting whatever the client sent —
  // `baseObjects` below keeps every real existing id, so a collision would
  // corrupt trap-kill attribution (spec section 23) for an unrelated object.
  const newObject: DraftObject = {
    id: randomUUID(),
    type: body.object.type,
    x: body.object.x,
    y: body.object.y,
  };

  const combined: DraftObject[] = [
    ...current.objects.map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y })),
    newObject,
  ];
  const errors = validatePlacement(combined);
  if (errors.length > 0) {
    return c.json<ProposeCurseResponse>({ status: 'error', errors });
  }

  const candidateToken = await createCurseCandidate(
    username,
    body.levelId,
    current.version,
    current.objects,
    newObject
  );
  return c.json<ProposeCurseResponse>({
    status: 'ok',
    candidateToken,
    parentVersion: current.version,
    objectId: newObject.id,
    previewLevel: {
      levelId: current.levelId,
      version: current.version + 1,
      parentVersion: current.version,
      objects: [
        ...current.objects,
        { ...newObject, properties: {}, addedBy: username, addedInVersion: current.version + 1 },
      ],
      contributorUsername: username,
      addedObjectId: newObject.id,
      verificationTimeMs: 0,
      createdAt: Date.now(),
    },
  });
});

curse.post('/publish', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to curse a level' },
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
  if (!isPublishCurseBody(body)) {
    return c.json<PublishCurseResponse>(
      { status: 'error', message: 'Invalid publish request' },
      400
    );
  }

  const candidate = await getCandidate(username);
  if (!isVerifiedCandidate(candidate, 'curse', body.candidateToken)) {
    return c.json<PublishCurseResponse>(
      {
        status: 'error',
        message: "This curse hasn't been verified — beat it first.",
      },
      400
    );
  }

  const { levelId, parentVersion, baseObjects, newObject, verifiedTimeMs } =
    candidate;
  const newVersionNumber = parentVersion + 1;

  // Simultaneous edits (spec section 18): the parent version this candidate
  // was verified against must still be current. `levelCurrentVersionKey` is
  // watched, so a concurrent publisher racing this one aborts our EXEC and
  // we retry with a fresh read rather than silently overwriting them.
  const result = await withTransaction<PublishCurseResponse>(
    [
      levelCurrentVersionKey(levelId),
      levelVersionKey(levelId, newVersionNumber),
      editorCandidateKey(username),
    ],
    async (tx) => {
      const currentCandidate = await getCandidate(username);
      if (!isVerifiedCandidate(currentCandidate, 'curse', body.candidateToken)) {
        return {
          commit: false,
          value: { status: 'error', message: 'Test session changed — press Test again.' },
        };
      }
      const storedVersionRaw = await redis.get(levelCurrentVersionKey(levelId));
      if (
        storedVersionRaw === undefined ||
        Number(storedVersionRaw) !== parentVersion
      ) {
        return {
          commit: false,
          value: {
            status: 'error',
            message:
              'THE LEVEL CHANGED — someone cursed it while you were proving your addition. Beat the newest version to publish it.',
            conflict: true,
          },
        };
      }

      const objects: LevelObject[] = [
        ...baseObjects,
        {
          id: newObject.id,
          type: newObject.type,
          x: newObject.x,
          y: newObject.y,
          properties: {},
          addedBy: username,
          addedInVersion: newVersionNumber,
        },
      ];
      const levelVersion: LevelVersion = {
        levelId,
        version: newVersionNumber,
        parentVersion,
        objects,
        contributorUsername: username,
        addedObjectId: newObject.id,
        verificationTimeMs: verifiedTimeMs,
        createdAt: Date.now(),
      };

      await tx.set(
        levelVersionKey(levelId, newVersionNumber),
        JSON.stringify(levelVersion)
      );
      await tx.set(levelCurrentVersionKey(levelId), String(newVersionNumber));
      await tx.del(editorCandidateKey(username));
      return {
        commit: true,
        value: { status: 'ok', levelId, version: newVersionNumber },
      };
    }
  );

  return c.json<PublishCurseResponse>(
    result,
    result.status === 'ok' ? 200 : 409
  );
});
