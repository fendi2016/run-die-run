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
