import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, realtime, redis } from '@devvit/web/server';
import {
  CURSE_CATEGORY_TYPES,
  isDraftObject,
  type DraftObject,
  type ProposeCurseResponse,
  type PublishCurseResponse,
} from '../../shared/editorApi';
import { computeLevelExtension, type LevelExtension } from '../../shared/levelExtend';
import { levelRealtimeChannel, type VersionPublishedEvent } from '../../shared/realtimeApi';
import type { LevelObject, LevelVersion } from '../../shared/types';
import {
  editorCandidateKey,
  levelCurrentVersionKey,
  levelVersionKey,
} from '../core/redisKeys';
import { CURSES_PER_DAY } from '../../shared/constants';
import { announceCurse } from '../core/announcements';
import { hasDailyQuota, recordDailyUse } from '../core/quota';
import { withTransaction } from '../core/transactions';
import { getCurrentLevelVersion } from '../services/LevelService';
import {
  createCurseCandidate,
  getCandidate,
  isVerifiedCandidate,
  validateCurseObject,
} from '../services/VerificationService';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const CURSE_TYPES = new Set(Object.values(CURSE_CATEGORY_TYPES).flat());

// The only types `removeObjectId` may ever point at — the same "platform"
// family the curse category picker itself groups together, reused rather
// than a second hardcoded list.
const REMOVABLE_TYPES = new Set(CURSE_CATEGORY_TYPES.platform);

function isProposeCurseBody(value: unknown): value is {
  levelId: string;
  object: DraftObject;
  extendByTiles?: number;
  removeObjectId?: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    value.levelId.length > 0 &&
    'object' in value &&
    isDraftObject(value.object) &&
    (!('extendByTiles' in value) ||
      (typeof value.extendByTiles === 'number' &&
        Number.isFinite(value.extendByTiles) &&
        value.extendByTiles >= 0)) &&
    (!('removeObjectId' in value) ||
      (typeof value.removeObjectId === 'string' &&
        value.removeObjectId.length > 0))
  );
}

// The extension objects, ready to fold into either the preview shown at
// propose time or the real published object list — same shape either way,
// only the addedInVersion/addedBy differ per call site.
function extensionAsLevelObjects(
  extension: LevelExtension,
  username: string,
  version: number
): LevelObject[] {
  return [...extension.groundTiles, extension.finish].map((o) => ({
    id: o.id,
    type: o.type,
    x: o.x,
    y: o.y,
    properties: {},
    addedBy: username,
    addedInVersion: version,
  }));
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
// than the base editor: exactly one new trap, chosen from a restricted
// category set, added on top of an existing published configuration it
// cannot otherwise touch — plus two optional add-ons, an extend (ground
// fill + relocated finish, shared/levelExtend.ts) and a platform removal,
// both always alongside the trap, never a substitute for it, since the
// leaderboard's kill attribution depends on every curse placing one.
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
  if (!(await hasDailyQuota('curse', username, CURSES_PER_DAY))) {
    return c.json<ProposeCurseResponse>(
      {
        status: 'error',
        errors: [`You've used all ${CURSES_PER_DAY} curses for today — come back tomorrow.`],
      },
      429
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

  const baseObjects: DraftObject[] = current.objects.map((o) => ({
    id: o.id,
    type: o.type,
    x: o.x,
    y: o.y,
  }));

  // Never trusted for *what* it is beyond the id (see
  // ProposeCurseRequest.removeObjectId's own comment) — looked up in this
  // level's own objects and checked against the same "platform" type set
  // the curse category picker itself offers, so the client can't smuggle
  // in the removal of a hazard, the spawn, or the finish portal.
  let removedObjectId: string | undefined;
  if (body.removeObjectId) {
    const target = baseObjects.find((o) => o.id === body.removeObjectId);
    if (!target || !REMOVABLE_TYPES.has(target.type)) {
      return c.json<ProposeCurseResponse>({
        status: 'error',
        errors: ['That object cannot be removed.'],
      });
    }
    removedObjectId = target.id;
  }

  // Recomputed from the tile count only — never from client-sent ground/
  // finish positions (see ProposeCurseRequest.extendByTiles's own comment).
  const extension = body.extendByTiles
    ? computeLevelExtension(
        baseObjects,
        body.extendByTiles,
        () => randomUUID(),
        () => randomUUID()
      )
    : undefined;

  // The trap's own placement is validated against what the level will
  // actually look like once both add-ons are applied — the extension (old
  // finish removed, new ground/finish added) and the removed platform
  // dropped entirely — not the pre-add-on configuration, so e.g. "that
  // would block the finish portal" checks the *new* finish position, and a
  // spot the removed platform used to occupy is free to place on.
  const effectiveBaseObjects: DraftObject[] = (
    extension
      ? [
          ...baseObjects.filter((o) => o.type !== 'finish'),
          ...extension.groundTiles,
          extension.finish,
        ]
      : baseObjects
  ).filter((o) => o.id !== removedObjectId);

  const errors = validateCurseObject(effectiveBaseObjects, newObject);
  if (errors.length > 0) {
    return c.json<ProposeCurseResponse>({ status: 'error', errors });
  }

  const candidateToken = await createCurseCandidate(
    username,
    body.levelId,
    current.version,
    current.objects,
    newObject,
    extension,
    removedObjectId
  );
  const extensionObjects = extension
    ? extensionAsLevelObjects(extension, username, current.version + 1)
    : [];
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
        ...current.objects.filter(
          (o) => !(extension && o.type === 'finish') && o.id !== removedObjectId
        ),
        ...extensionObjects,
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

  const {
    levelId,
    parentVersion,
    baseObjects,
    newObject,
    extension,
    removedObjectId,
    verifiedTimeMs,
  } = candidate;
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

      const extensionObjects = extension
        ? extensionAsLevelObjects(extension, username, newVersionNumber)
        : [];
      const objects: LevelObject[] = [
        ...baseObjects.filter(
          (o) => !(extension && o.type === 'finish') && o.id !== removedObjectId
        ),
        ...extensionObjects,
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

  if (result.status === 'ok') {
    await recordDailyUse('curse', username);
    // A curse always lands on an already-live level (unlike the base
    // editor's first publish, which has no one subscribed yet) — this is
    // the one place spec section 29's "new version published"/"new
    // community addition" notice actually has a live audience to reach.
    const event: VersionPublishedEvent = {
      type: 'versionPublished',
      levelId: result.levelId,
      version: result.version,
      authorUsername: username,
      addedType: newObject.type,
    };
    await realtime
      .send(levelRealtimeChannel(result.levelId), event)
      .catch(() => undefined);
    await announceCurse({
      levelId: result.levelId,
      version: result.version,
      username,
      addedType: newObject.type,
      removedPlatform: removedObjectId !== undefined,
      extended: extension !== undefined,
    });
  }

  return c.json<PublishCurseResponse>(
    result,
    result.status === 'ok' ? 200 : 409
  );
});
