// MVP object set from spec section 39. Extend this union (and the client's
// ObjectRegistry, added in a later phase) rather than hardcoding new types
// elsewhere.
export type ObjectType =
  | 'ground'
  | 'platform'
  | 'movingPlatform'
  | 'spike'
  | 'saw'
  | 'movingSaw'
  | 'candle'
  | 'bat'
  | 'ghost'
  | 'fallingBlock'
  | 'doubleJump'
  | 'shield'
  | 'speedBoost'
  | 'slowTime'
  | 'autoDash'
  | 'spawn'
  | 'finish';

// A single placed object within a level version. `addedBy` / `addedInVersion`
// carry attribution (spec section 23) so trap kills and contributor stats can
// be traced back to the player who placed the object.
export type LevelObject = {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  addedBy: string;
  addedInVersion: number;
};

// An immutable, published snapshot of a level (spec section 17). Never
// mutated in place — a curse produces a new LevelVersion with an incremented
// `version` and `parentVersion` pointing at the one it was built on.
export type LevelVersion = {
  levelId: string;
  version: number;
  parentVersion: number | null;
  objects: LevelObject[];
  contributorUsername: string;
  addedObjectId?: string;
  verificationTimeMs: number;
  createdAt: number;
};

// A single completed run, submitted to the server for leaderboard ranking.
// The server is the authority on rank (spec section 19) — this is just the
// claim the client makes about its own run.
export type RunResult = {
  levelId: string;
  version: number;
  timeMs: number;
  username: string;
};

// Exported so services building a curse candidate (spec sections 14-20) can
// validate a `LevelObject[]` read back out of Redis without an `as` cast.
export function isLevelObject(value: unknown): value is LevelObject {
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
    typeof value.y === 'number' &&
    'properties' in value &&
    typeof value.properties === 'object' &&
    value.properties !== null &&
    'addedBy' in value &&
    typeof value.addedBy === 'string' &&
    'addedInVersion' in value &&
    typeof value.addedInVersion === 'number'
  );
}

// Runtime guard used on both ends: the server validates JSON pulled back out
// of Redis, the client validates the fetch response. Avoids an `as` cast on
// untyped JSON (AGENTS.md: never cast TypeScript types).
export function isLevelVersion(value: unknown): value is LevelVersion {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    'version' in value &&
    typeof value.version === 'number' &&
    'parentVersion' in value &&
    (value.parentVersion === null || typeof value.parentVersion === 'number') &&
    'objects' in value &&
    Array.isArray(value.objects) &&
    value.objects.every(isLevelObject) &&
    'contributorUsername' in value &&
    typeof value.contributorUsername === 'string' &&
    'verificationTimeMs' in value &&
    typeof value.verificationTimeMs === 'number' &&
    'createdAt' in value &&
    typeof value.createdAt === 'number'
  );
}
