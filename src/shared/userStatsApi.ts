// Wire contract for GET /api/stats/me — a personal stats snapshot pulled
// together from data that was already being tracked (currency, clear
// streak, levels created, contribution kills) but never surfaced anywhere
// as a single "your stats" view.
export type UserStatsResponse = {
  username: string;
  currencyBalance: number;
  // Clear Streaks (spec section 28): lifetime count of unique level
  // versions cleared, never reset — same value shown on the result
  // overlay's "Streak: N" line (see runsApi.ts).
  clearStreak: number;
  // Every non-duplicate clear, including replays of an already-cleared
  // version — unlike clearStreak, this keeps growing on a replay.
  totalClears: number;
  levelsCreated: number;
  // Total trap kills scored by every object this user has ever added
  // (base levels and curses both) — the personal, cross-level counterpart
  // to the per-level "Top Cursers" board.
  contributionKills: number;
};

export function isUserStatsResponse(
  value: unknown
): value is UserStatsResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'username' in value &&
    typeof value.username === 'string' &&
    'currencyBalance' in value &&
    typeof value.currencyBalance === 'number' &&
    'clearStreak' in value &&
    typeof value.clearStreak === 'number' &&
    'totalClears' in value &&
    typeof value.totalClears === 'number' &&
    'levelsCreated' in value &&
    typeof value.levelsCreated === 'number' &&
    'contributionKills' in value &&
    typeof value.contributionKills === 'number'
  );
}
