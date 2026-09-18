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
