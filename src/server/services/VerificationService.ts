import { randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import {
  EDITOR_MAX_COLUMNS,
  EDITOR_MAX_OBJECTS,
  EDITOR_MAX_ROWS,
  EDITOR_SPAWN_BUFFER_CELLS,
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
} from '../../shared/constants';
import {
  CURSE_CATEGORY_TYPES,
  isDraftObject,
  type DraftObject,
} from '../../shared/editorApi';
import { isLevelObject, type LevelObject } from '../../shared/types';
import { withTransaction } from '../core/transactions';
import { editorCandidateKey } from '../core/redisKeys';

const HAZARD_TYPES = new Set(CURSE_CATEGORY_TYPES.hazard);

// How long a "Test" candidate survives without being verified or published
// (spec section 36: reasonable server authority, not weeks of anti-cheat).
const CANDIDATE_TTL_SECONDS = 60 * 60;

const MIN_X = 0;
const MAX_X = EDITOR_MAX_COLUMNS * GRID_CELL_SIZE;
const MIN_Y = GROUND_TOP_Y - (EDITOR_MAX_ROWS - 1) * GRID_CELL_SIZE;
const MAX_Y = GROUND_TOP_Y;

type CandidateCommon = {
  token: string;
  verified: boolean;
  verifiedTimeMs: number | undefined;
  createdAt: number;
};

// A base-editor "Test" candidate (spec sections 12-13): the whole draft
// object list gets published as-is on success.
export type CreateCandidate = CandidateCommon & {
  kind: 'create';
  objects: DraftObject[];
};

// A curse candidate (spec sections 14-20): `baseObjects` is the exact
// published configuration the curse was proposed against (frozen at
// propose time so a later concurrent curse can't silently change what this
// player is verifying), `newObject` is the single object they're adding.
export type CurseCandidate = CandidateCommon & {
  kind: 'curse';
  levelId: string;
  parentVersion: number;
  baseObjects: LevelObject[];
  newObject: DraftObject;
};

export type EditorCandidate = CreateCandidate | CurseCandidate;

// The "candidate exists, is the right kind, matches this token, and has
// been verified" gate both publish routes (base editor and curse) need
// before writing anything — previously re-implemented independently as an
// inline boolean check in curse.ts and publish.ts, which meant a new
// required field (e.g. an expiry check) would have to be added to both by
// hand, and missing one would silently accept an unverified/stale
// candidate as valid rather than just being a style inconsistency.
export function isVerifiedCandidate<K extends EditorCandidate['kind']>(
  candidate: EditorCandidate | undefined,
  kind: K,
  token: string
): candidate is Extract<EditorCandidate, { kind: K }> & {
  verified: true;
  verifiedTimeMs: number;
} {
  return (
    candidate !== undefined &&
    candidate.kind === kind &&
    candidate.token === token &&
    candidate.verified &&
    candidate.verifiedTimeMs !== undefined
  );
}

function isCandidateCommon(value: object): value is CandidateCommon {
  return (
    'token' in value &&
    typeof value.token === 'string' &&
    'verified' in value &&
    typeof value.verified === 'boolean' &&
    'createdAt' in value &&
    typeof value.createdAt === 'number'
  );
}

function isEditorCandidate(value: unknown): value is EditorCandidate {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isCandidateCommon(value)
  ) {
    return false;
  }
  if (!('kind' in value)) {
    return false;
  }
  if (value.kind === 'create') {
    return (
      'objects' in value &&
      Array.isArray(value.objects) &&
      value.objects.every(isDraftObject)
    );
  }
  if (value.kind === 'curse') {
    return (
      'levelId' in value &&
      typeof value.levelId === 'string' &&
      'parentVersion' in value &&
      typeof value.parentVersion === 'number' &&
      'baseObjects' in value &&
      Array.isArray(value.baseObjects) &&
      value.baseObjects.every(isLevelObject) &&
      'newObject' in value &&
      isDraftObject(value.newObject)
    );
  }
  return false;
}

// Canonical ordering/shape so "the configuration verified" and "the
// configuration published" can be compared for exact equality (spec
// section 20) regardless of array ordering or extraneous fields.
export function canonicalizeObjects(objects: DraftObject[]): string {
  return JSON.stringify(
    [...objects]
      .map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

// Placement-rule validation (spec section 20). Verification (the creator
// personally beating the level) is the primary protection; these are the
// structural checks cheap enough to run before that, per section 20's own
// framing ("Verification is the primary protection. Also enforce placement
// rules.") — deliberately not a reachability solver.
export function validatePlacement(objects: DraftObject[]): string[] {
  const errors: string[] = [];

  if (objects.length === 0) {
    errors.push('Level has no objects.');
    return errors;
  }
  if (objects.length > EDITOR_MAX_OBJECTS) {
    errors.push(`Level has too many objects (max ${EDITOR_MAX_OBJECTS}).`);
  }

  const spawns = objects.filter((o) => o.type === 'spawn');
  const finishes = objects.filter((o) => o.type === 'finish');
  if (spawns.length !== 1) {
    errors.push('Level must have exactly one spawn point.');
  }
  if (finishes.length !== 1) {
    errors.push('Level must have exactly one finish portal.');
  }

  for (const object of objects) {
    if (
      object.x < MIN_X ||
      object.x >= MAX_X ||
      object.y < MIN_Y ||
      object.y > MAX_Y
    ) {
      errors.push(`Object "${object.id}" is outside the level boundaries.`);
    }
  }

  // Ground is top-anchored (its body extends *below* y) while every other
  // type is bottom-anchored (its body extends *above* y, sitting on the
  // surface) — see ObjectRegistry.originFor. A hazard/spawn/finish/platform
  // resting on its own supporting ground tile therefore shares that tile's
  // exact (x, y) by design (every seed level does this), so ground is
  // tracked in a separate bucket from everything else: two grounds sharing
  // a cell is still a real duplicate, and two non-ground objects sharing a
  // cell is still a real duplicate, but a ground/non-ground pair is not.
  const seenGroundPositions = new Map<string, string>();
  const seenOtherPositions = new Map<string, string>();
  for (const object of objects) {
    const key = `${object.x},${object.y}`;
    const bucket =
      object.type === 'ground' ? seenGroundPositions : seenOtherPositions;
    const existingId = bucket.get(key);
    if (existingId) {
      errors.push(
        `Objects "${existingId}" and "${object.id}" occupy the same location.`
      );
    } else {
      bucket.set(key, object.id);
    }
  }

  const spawn = spawns[0];
  if (spawn) {
    const bufferPx = EDITOR_SPAWN_BUFFER_CELLS * GRID_CELL_SIZE;
    for (const object of objects) {
      if (object.id === spawn.id || object.type === 'ground') {
        continue;
      }
      if (Math.abs(object.x - spawn.x) < bufferPx) {
        errors.push(`Object "${object.id}" is too close to the spawn point.`);
      }
    }
  }

  const finish = finishes[0];
  if (finish) {
    const hazardBlockingFinish = objects.some(
      (o) =>
        o.id !== finish.id &&
        o.x === finish.x &&
        o.y === finish.y &&
        HAZARD_TYPES.has(o.type)
    );
    if (hazardBlockingFinish) {
      errors.push('A hazard is blocking the finish portal.');
    }
  }

  return errors;
}

export async function createCandidate(
  username: string,
  objects: DraftObject[]
): Promise<string> {
  const candidate: EditorCandidate = {
    kind: 'create',
    token: randomUUID(),
    objects,
    verified: false,
    verifiedTimeMs: undefined,
    createdAt: Date.now(),
  };
  await redis.set(editorCandidateKey(username), JSON.stringify(candidate), {
    expiration: new Date(Date.now() + CANDIDATE_TTL_SECONDS * 1000),
  });
  return candidate.token;
}

// Starting a curse test overwrites any previous candidate for this user
// (same one-candidate-per-user Redis key as the base editor's `createCandidate`
// — a player can only be mid-verification of one thing at a time).
export async function createCurseCandidate(
  username: string,
  levelId: string,
  parentVersion: number,
  baseObjects: LevelObject[],
  newObject: DraftObject
): Promise<string> {
  const candidate: EditorCandidate = {
    kind: 'curse',
    token: randomUUID(),
    levelId,
    parentVersion,
    baseObjects,
    newObject,
    verified: false,
    verifiedTimeMs: undefined,
    createdAt: Date.now(),
  };
  await redis.set(editorCandidateKey(username), JSON.stringify(candidate), {
    expiration: new Date(Date.now() + CANDIDATE_TTL_SECONDS * 1000),
  });
  return candidate.token;
}

export async function getCandidate(
  username: string
): Promise<EditorCandidate | undefined> {
  const raw = await redis.get(editorCandidateKey(username));
  if (raw === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isEditorCandidate(parsed)) {
    console.error(`Corrupt editor candidate for "${username}"`);
    return undefined;
  }
  return parsed;
}

export async function markCandidateVerified(
  username: string,
  candidateToken: string,
  timeMs: number
): Promise<boolean> {
  const key = editorCandidateKey(username);
  return withTransaction([key], async (tx) => {
    const candidate = await getCandidate(username);
    if (!candidate || candidate.token !== candidateToken) {
      return { commit: false, value: false };
    }
    candidate.verified = true;
    candidate.verifiedTimeMs = timeMs;
    await tx.set(key, JSON.stringify(candidate), {
      expiration: new Date(Date.now() + CANDIDATE_TTL_SECONDS * 1000),
    });
    return { commit: true, value: true };
  });
}
