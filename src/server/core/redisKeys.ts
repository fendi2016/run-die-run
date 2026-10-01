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

// How many moderator undos a level has had. Each undo is its own version
// that removes a sabotage, so sabotages in effect = version - 1 - 2 * undos.
export const levelUndosKey = (levelId: string): string =>
  `level:${levelId}:undos`;

export const versionLeaderboardKey = (
  levelId: string,
  version: number
): string => `level:${levelId}:version:${version}:leaderboard`;

// Death markers (faint skulls the client draws on the level): a sorted set
// of death-x-bucket -> death count, scoped to one level version so a
// republish's changed geometry never inherits a stale skull field from an
// earlier version's layout.
export const levelDeathsKey = (levelId: string, version: number): string =>
  `level:${levelId}:version:${version}:deaths`;

export const userStatsKey = (redditId: string): string =>
  `user:${redditId}:stats`;

export const userCreatedLevelsKey = (redditId: string): string =>
  `user:${redditId}:createdLevels`;

export const userContributionsKey = (redditId: string): string =>
  `user:${redditId}:contributions`;

export const trapKillsKey = (objectId: string): string =>
  `trap:${objectId}:kills`;

// Unique players a trap has killed (username -> kill count) and unique
// players who got past it (username -> '1'); hLen of each is the count the
// trap's owner sees. See TrapStatsService.
export const trapCaughtByKey = (objectId: string): string =>
  `trap:${objectId}:caughtBy`;
export const trapPassedByKey = (objectId: string): string =>
  `trap:${objectId}:passedBy`;

// Every curse a player has placed (objectId -> JSON { levelId, type,
// placedAt }), and the caught/passed counts they last saw for each.
export const userCursesKey = (username: string): string =>
  `user:${username}:curses`;
export const userCursesSeenKey = (username: string): string =>
  `user:${username}:cursesSeen`;

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

// Browse's sort indexes (DiscoveryService): one sorted set per ordering,
// levelId -> that sort's score, kept current as levels are played, cursed
// and published so a listing reads ids instead of every level's counters.
// `createdAt` also covers the seed levels (allLevelsByDateKey doesn't).
// Trending's daily part lives in its own per-day set, so it resets at the
// UTC day boundary without a rewrite of every level.
export type DiscoveryIndex = 'createdAt' | 'deadliest' | 'speedrun' | 'curses';
export const discoveryIndexKey = (index: DiscoveryIndex): string =>
  `discovery:index:${index}`;
export const discoveryTrendingKey = (day: number): string =>
  `discovery:index:trending:${day}`;
// Schema version of the indexes above; a mismatch triggers a one-time
// backfill from the level data.
export const discoveryIndexVersionKey = (): string => 'discovery:index:version';

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

// Clear Streaks (spec section 28): a Hash of every "{levelId}:{version}"
// the user has ever cleared -> '1'. There's no native Redis Set in this
// Devvit runtime, so a Hash stands in for one — `hSetNX` gives the same
// "was this newly added" signal a Set's membership-before-add check would,
// and `hLen` gives the same cardinality a Set's SCARD would. The streak
// count is this hash's length, never reset (never a separate counter to
// drift out of sync with it).
export const clearedVersionsKey = (username: string): string =>
  `user:${username}:clearedVersions`;

// Global (not per-level) sorted set of username -> streak count. Still
// maintained (feeds the result overlay's "CURRENT SURVIVAL STREAK" line)
// even though nothing exposes it as its own leaderboard view right now.
export const streaksLeaderboardKey = (): string => 'streaks:leaderboard';

// Global (not per-level) sorted set of username -> total trap kills their
// added objects have scored across every level (spec section 24's "TOP
// CURSERS", generalized from per-level to the one global leaderboard the
// UI actually shows) — a ranking companion to `userContributionsKey`'s
// plain counter, same relationship `levelContributorKillsKey` already has
// to that counter at the per-level scope.
export const topCursersKey = (): string => 'topCursers:leaderboard';

// Keep receipts for explicit submissions so a delayed retry remains safe.
export const runSubmissionKey = (username: string, submissionId: string): string =>
  `run:submission:${username}:${submissionId}`;

// Per-user, per-UTC-day action counter backing the publish/curse caps
// (core/quota.ts). Expires on its own a day after the window closes.
export const dailyQuotaKey = (
  action: string,
  username: string,
  day: number
): string => `quota:${action}:${day}:${username}`;

// The level's canonical Reddit post (the one made when it was published,
// or its first daily feature for a seed level). Set once, never replaced,
// so curse comments always land on the same thread.
export const levelPostKey = (levelId: string): string =>
  `level:${levelId}:postId`;

// Level of the Day (services/DailyService.ts): how many have been posted
// (the #N in the title), the UTC day of the last one (so a scheduler retry
// can't double-post), levelId -> day it was last featured, and the levelId
// featured most recently (what a hub post plays).
export const dailyCountKey = (): string => 'daily:count';
export const dailyLastPostedDayKey = (): string => 'daily:lastPostedDay';
export const dailyFeaturedKey = (): string => 'daily:featured';
export const dailyCurrentKey = (): string => 'daily:current';

// '1' once this player has finished or skipped the first-play tutorial, so
// it isn't forced on them again on another post or device where the
// client's localStorage flag isn't there.
export const userTutorialDoneKey = (username: string): string =>
  `user:${username}:tutorialDone`;

// Game-wide analytics (see AnalyticsService), per UTC day (YYYY-MM-DD) and
// expired after ANALYTICS_RETENTION_SECONDS: event totals (hash), unique
// players per funnel step and active/new players (sorted sets of
// usernames), day-1/day-7 returns of that day's new players, devices of
// that day's players, and load-time buckets. A player's first-seen day is
// kept for good so returns can be measured.
export const analyticsCountsKey = (day: string): string => `analytics:${day}:counts`;
export const analyticsStepKey = (day: string, step: string): string =>
  `analytics:${day}:step:${step}`;
export const analyticsActiveKey = (day: string): string => `analytics:${day}:active`;
export const analyticsNewKey = (day: string): string => `analytics:${day}:new`;
export const analyticsReturnsKey = (day: string): string => `analytics:${day}:returns`;
export const analyticsDeviceKey = (day: string): string => `analytics:${day}:device`;
export const analyticsLoadKey = (day: string): string => `analytics:${day}:load`;
export const analyticsFirstSeenKey = (username: string): string =>
  `analytics:firstSeen:${username}`;

// How many comments this player has posted on a level's post via the
// after-sabotage prompt (see curse.ts /comment): capped at the number of
// traps they've placed there.
export const userCurseCommentsKey = (username: string, levelId: string): string =>
  `user:${username}:curseComments:${levelId}`;
