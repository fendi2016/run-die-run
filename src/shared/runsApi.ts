// Wire contract for POST /api/runs (spec sections 8–9). The client only
// claims a level/version/time — rank, personal best, and world record are
// always computed server-side (spec section 19: never trust the client to
// assign rank).
export type SubmitRunRequest = {
  levelId: string;
  version: number;
  timeMs: number;
};

export type LeaderboardEntry = {
  username: string;
  timeMs: number;
};

export type SubmitRunResponse = {
  timeMs: number;
  rank: number;
  personalBestMs: number;
  isNewPersonalBest: boolean;
  worldRecordMs: number;
  topTen: LeaderboardEntry[];
};

// Runtime guard for the fetch response on the client side. Avoids an `as`
// cast on untyped JSON (AGENTS.md: never cast TypeScript types) by narrowing
// through `in` + `typeof` checks instead.
export function isSubmitRunResponse(
  value: unknown
): value is SubmitRunResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'timeMs' in value &&
    typeof value.timeMs === 'number' &&
    'rank' in value &&
    typeof value.rank === 'number' &&
    'personalBestMs' in value &&
    typeof value.personalBestMs === 'number' &&
    'isNewPersonalBest' in value &&
    typeof value.isNewPersonalBest === 'boolean' &&
    'worldRecordMs' in value &&
    typeof value.worldRecordMs === 'number' &&
    'topTen' in value &&
    Array.isArray(value.topTen)
  );
}

// Wire contract for POST /api/runs/trap-kill (spec section 23: trap
// ownership/attribution). Fired-and-forgotten from the death path so it
// never delays the instant respawn (spec section 30) — `objectId` is the
// hazard that killed the player, already known client-side from the loaded
// LevelVersion, so this call exists only to grow the server-authoritative
// kill counters, not to discover who owns the trap.
export type TrapKillRequest = {
  levelId: string;
  version: number;
  objectId: string;
};

export type TrapKillResponse = {
  objectId: string;
  kills: number;
  addedBy: string;
  contributorTotalKills: number;
};

export function isTrapKillResponse(value: unknown): value is TrapKillResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objectId' in value &&
    typeof value.objectId === 'string' &&
    'kills' in value &&
    typeof value.kills === 'number' &&
    'addedBy' in value &&
    typeof value.addedBy === 'string' &&
    'contributorTotalKills' in value &&
    typeof value.contributorTotalKills === 'number'
  );
}
