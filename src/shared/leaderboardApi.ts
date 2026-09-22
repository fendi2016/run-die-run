// Wire contract for GET /api/leaderboard — the one global "TOP CURSERS"
// board (spec section 24), ranked by total trap kills a contributor's
// placed objects have scored across every level. Not per-level and not
// time-based: this game is an auto-runner (pace is set by the side-scroll,
// not player input speed), so a level's clear time isn't a meaningful
// competitive axis — kills from the traps you've placed are.
export type CurserEntry = {
  username: string;
  kills: number;
};

export type CursersLeaderboardResponse = {
  topTen: CurserEntry[];
};

export function isCursersLeaderboardResponse(
  value: unknown
): value is CursersLeaderboardResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'topTen' in value &&
    Array.isArray(value.topTen)
  );
}
