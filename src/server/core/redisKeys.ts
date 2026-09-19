// Central Redis key namespace (spec section 35). Every service that reads or
// writes level, version, leaderboard, or user data should build its keys
// through these functions rather than inlining key strings, so the schema
// only needs to change in one place.

export const levelMetaKey = (levelId: string): string =>
  `level:${levelId}:meta`;

export const levelCurrentVersionKey = (levelId: string): string =>
  `level:${levelId}:currentVersion`;

export const levelVersionKey = (levelId: string, version: number): string =>
  `level:${levelId}:version:${version}`;

export const versionLeaderboardKey = (
  levelId: string,
  version: number
): string => `level:${levelId}:version:${version}:leaderboard`;

export const userStatsKey = (redditId: string): string =>
  `user:${redditId}:stats`;

export const userCreatedLevelsKey = (redditId: string): string =>
  `user:${redditId}:createdLevels`;

export const userContributionsKey = (redditId: string): string =>
  `user:${redditId}:contributions`;

export const trapKillsKey = (objectId: string): string =>
  `trap:${objectId}:kills`;

// Per-level "TOP CURSERS" leaderboard (spec section 24): a sorted set of
// contributor username -> total kills their added objects have scored on
// this specific level, distinct from `userContributionsKey`'s cross-level
// total for that same contributor.
export const levelContributorKillsKey = (levelId: string): string =>
  `level:${levelId}:contributorKills`;

// One in-progress editor candidate per user (spec section 20/36: the
// server-side candidate a "Test" run is verified against, later checked
// again at publish time). Starting a new test overwrites any previous one.
export const editorCandidateKey = (username: string): string =>
  `editor:candidate:${username}`;

// Discovery (spec sections 25-27): a global index of published levelIds by
// creation time (there's otherwise no way to enumerate all levels), plus
// per-level attempt/clear counters and a rolling daily activity window
// used for the trending score.
export const allLevelsByDateKey = (): string => 'discovery:levels:createdAt';
export const levelAttemptsKey = (levelId: string): string =>
  `level:${levelId}:attempts`;
export const levelClearsKey = (levelId: string): string =>
  `level:${levelId}:clears`;
export const levelDailyPlayersKey = (levelId: string, day: number): string =>
  `level:${levelId}:discovery:${day}:players`;
export const levelDailyClearsKey = (levelId: string, day: number): string =>
  `level:${levelId}:discovery:${day}:clears`;

// A short-lived marker so a retried/duplicate `POST /api/runs` for the
// exact same (level, version, player, time) doesn't double-count an
// attempt/clear in Discovery's stats — the leaderboard write itself is
// already naturally idempotent (a worse or equal time just no-ops), but
// the attempt/clear counters aren't.
export const runDedupeKey = (
  levelId: string,
  version: number,
  username: string,
  timeMs: number
): string => `run:dedupe:${levelId}:${version}:${username}:${timeMs}`;
