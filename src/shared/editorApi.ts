import { isLevelVersion, type LevelVersion, type ObjectType } from './types';

// Curse categories (spec sections 14-15): the curse UI is deliberately
// smaller than the base editor's full palette. Types are grouped here (not
// hardcoded per-screen) so both the client picker and the server's
// propose-time validation agree on what's placeable. An empty category
// disables itself in the UI rather than offering a type that would render
// nothing.
export type CurseCategory = 'hazard' | 'platform' | 'powerUp';

export const CURSE_CATEGORY_TYPES: Record<CurseCategory, ObjectType[]> = {
  hazard: ['candle', 'saw', 'movingSaw', 'bat', 'ghost'],
  platform: ['platform', 'movingPlatform'],
  powerUp: ['shield', 'speedBoost'],
};

// Wire contract for the base level editor's test/publish flow (spec
// sections 12-13, 20). The server never trusts a client-computed "I beat
// it" claim in isolation: `candidateToken` ties one exact object
// configuration to one verified run, and the publish step re-checks both
// before writing anything (spec section 20: "do not let the player verify
// one configuration and publish another").
export type DraftObject = {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
};

export type ValidateLevelRequest = {
  objects: DraftObject[];
};

export type ValidateLevelResponse =
  | { status: 'ok'; candidateToken: string }
  | { status: 'error'; errors: string[] };

export type VerifyLevelRequest = {
  candidateToken: string;
  timeMs: number;
};

export type VerifyLevelResponse =
  { status: 'ok' } | { status: 'error'; message: string };

export type PublishLevelRequest = {
  candidateToken: string;
  title: string;
  objects: DraftObject[];
};

// `postUrl` is the level's new Reddit post — absent if the post couldn't
// be created (the level itself is still published and playable).
export type PublishLevelResponse =
  | { status: 'ok'; levelId: string; version: number; postUrl?: string }
  | { status: 'error'; message: string };

// Shape guard for JSON crossing an untyped boundary (AGENTS.md: never cast
// TypeScript types). Used server-side to validate request bodies and
// client-side when re-hydrating a candidate record read back from Redis.
export function isDraftObject(value: unknown): value is DraftObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'type' in value &&
    typeof value.type === 'string' &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number'
  );
}

// Parses the editor's "Load from JSON" textarea (spec: HONK-style JSON
// import, reshaped to CURSED's own editor rather than copied wholesale —
// see docs/plans). Returns null on anything that isn't exactly a
// DraftObject[] — invalid JSON, a non-array, or an array with a malformed
// element — so the caller can show one generic "that's not valid level
// JSON" message instead of surfacing a raw parser exception.
export function parseDraftObjectsJson(json: string): DraftObject[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every(isDraftObject)) {
    return null;
  }
  return parsed;
}

export function isValidateLevelResponse(
  value: unknown
): value is ValidateLevelResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return false;
  }
  if (value.status === 'ok') {
    return (
      'candidateToken' in value && typeof value.candidateToken === 'string'
    );
  }
  if (value.status === 'error') {
    return 'errors' in value && Array.isArray(value.errors);
  }
  return false;
}

export function isVerifyLevelResponse(
  value: unknown
): value is VerifyLevelResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return false;
  }
  if (value.status === 'ok') {
    return true;
  }
  if (value.status === 'error') {
    return 'message' in value && typeof value.message === 'string';
  }
  return false;
}

export function isPublishLevelResponse(
  value: unknown
): value is PublishLevelResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return false;
  }
  if (value.status === 'ok') {
    return (
      'levelId' in value &&
      typeof value.levelId === 'string' &&
      'version' in value &&
      typeof value.version === 'number' &&
      (!('postUrl' in value) || typeof value.postUrl === 'string')
    );
  }
  if (value.status === 'error') {
    return 'message' in value && typeof value.message === 'string';
  }
  return false;
}

// Wire contract for the curse flow's own propose/verify/publish cycle
// (spec sections 14-20). Verify reuses `/api/publish/verify` and
// `VerifyLevelRequest`/`VerifyLevelResponse` above — the candidate/token
// mechanics are identical, only the shape of what gets built at publish
// time differs (a whole new level vs. one new object appended to an
// existing one), so only propose/publish need their own contracts here.
export type ProposeCurseRequest = {
  levelId: string;
  object: DraftObject;
  // Requested tile count for the level-extend feature (shared/levelExtend
  // .ts) — an optional add-on alongside `object`, never a substitute for
  // it (a curse always requires placing a trap; the leaderboard's kill
  // attribution is built on that). Just a count, not the computed
  // ground/finish positions themselves — the server recomputes those
  // itself from the current published objects rather than trusting
  // client-sent positions.
  extendByTiles?: number;
  // The id of an existing platform/movingPlatform to remove — another
  // optional add-on alongside `object`, never a substitute, same reasoning
  // as extendByTiles above. Only an id: the server looks the object up in
  // the current published level and validates its type itself (must be
  // one of CURSE_CATEGORY_TYPES.platform) rather than trusting the client
  // on *what* it's removing.
  removeObjectId?: string;
};

export type ProposeCurseResponse =
  | {
      status: 'ok';
      candidateToken: string;
      parentVersion: number;
      objectId: string;
      previewLevel: LevelVersion;
    }
  | { status: 'error'; errors: string[] };

export type PublishCurseRequest = {
  candidateToken: string;
};

export type PublishCurseResponse =
  | { status: 'ok'; levelId: string; version: number }
  | { status: 'error'; message: string; conflict?: boolean };

export function isProposeCurseResponse(
  value: unknown
): value is ProposeCurseResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return false;
  }
  if (value.status === 'ok') {
    return (
      'candidateToken' in value &&
      typeof value.candidateToken === 'string' &&
      'parentVersion' in value &&
      typeof value.parentVersion === 'number' &&
      'objectId' in value &&
      typeof value.objectId === 'string' &&
      'previewLevel' in value &&
      isLevelVersion(value.previewLevel)
    );
  }
  if (value.status === 'error') {
    return 'errors' in value && Array.isArray(value.errors);
  }
  return false;
}

export function isPublishCurseResponse(
  value: unknown
): value is PublishCurseResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return false;
  }
  if (value.status === 'ok') {
    return (
      'levelId' in value &&
      typeof value.levelId === 'string' &&
      'version' in value &&
      typeof value.version === 'number'
    );
  }
  if (value.status === 'error') {
    return 'message' in value && typeof value.message === 'string';
  }
  return false;
}
