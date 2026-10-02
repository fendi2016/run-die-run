export type DiscoverySort = 'new' | 'trending' | 'deadliest' | 'speedrun';
export type Difficulty =
  'UNRATED' | 'EASY' | 'NORMAL' | 'HARD' | 'CURSED' | 'NIGHTMARE';
export type LevelSummary = {
  levelId: string;
  title: string;
  creatorUsername: string;
  version: number;
  sabotages: number;
  difficulty: Difficulty;
  attempts: number;
  clears: number;
  completionRate: number;
  worldRecordMs: number | null;
  createdAt: number;
  trendingScore: number;
};
// One page of a sort; `nextCursor` is the `cursor` query for the page
// after it, or null on the last page.
export type DiscoveryResponse = { levels: LevelSummary[]; nextCursor: number | null };
// Next Level after a clear (GET /api/discovery/next?after=<levelId>).
export type NextLevelResponse = { next: { levelId: string; title: string } | null };

// What a post's feed card (splash) and the in-game menu show about the
// one level that post plays. `postId` is the level's canonical post, used
// as the share-sheet target.
export type LevelStats = {
  title: string;
  creatorUsername: string;
  version: number;
  // Sabotages in effect (moderator undos take theirs back out).
  sabotages: number;
  attempts: number;
  clears: number;
  difficulty: Difficulty;
  postId?: string;
  // The creator's Reddit avatar, for the feed card's "Made by" credit.
  creatorAvatarUrl?: string;
  // Every kill this level's traps have scored, shown next to the play
  // count ("☠ 476"). Absent until the first one.
  trapKills?: number;
};

export function isLevelStats(value: unknown): value is LevelStats {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    'creatorUsername' in value &&
    typeof value.creatorUsername === 'string' &&
    'version' in value &&
    isCount(value.version) &&
    'sabotages' in value &&
    isCount(value.sabotages) &&
    'attempts' in value &&
    isCount(value.attempts) &&
    'clears' in value &&
    isCount(value.clears) &&
    'difficulty' in value &&
    isDifficulty(value.difficulty) &&
    (!('postId' in value) || typeof value.postId === 'string') &&
    (!('creatorAvatarUrl' in value) || typeof value.creatorAvatarUrl === 'string') &&
    (!('trapKills' in value) || isCount(value.trapKills))
  );
}

export function isDiscoverySort(value: unknown): value is DiscoverySort {
  return (
    value === 'new' ||
    value === 'trending' ||
    value === 'deadliest' ||
    value === 'speedrun'
  );
}
function isDifficulty(value: unknown): value is Difficulty {
  return (
    value === 'UNRATED' ||
    value === 'EASY' ||
    value === 'NORMAL' ||
    value === 'HARD' ||
    value === 'CURSED' ||
    value === 'NIGHTMARE'
  );
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function isLevelSummary(value: unknown): value is LevelSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'creatorUsername' in value &&
    typeof value.creatorUsername === 'string' &&
    'version' in value &&
    isCount(value.version) &&
    value.version > 0 &&
    'sabotages' in value &&
    isCount(value.sabotages) &&
    'difficulty' in value &&
    isDifficulty(value.difficulty) &&
    'attempts' in value &&
    isCount(value.attempts) &&
    'clears' in value &&
    isCount(value.clears) &&
    value.clears <= value.attempts &&
    'completionRate' in value &&
    typeof value.completionRate === 'number' &&
    Number.isFinite(value.completionRate) &&
    value.completionRate >= 0 &&
    value.completionRate <= 1 &&
    'worldRecordMs' in value &&
    (value.worldRecordMs === null ||
      (typeof value.worldRecordMs === 'number' &&
        Number.isFinite(value.worldRecordMs) &&
        value.worldRecordMs > 0)) &&
    'createdAt' in value &&
    isCount(value.createdAt) &&
    'trendingScore' in value &&
    isCount(value.trendingScore)
  );
}
export function isDiscoveryResponse(
  value: unknown
): value is DiscoveryResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levels' in value &&
    Array.isArray(value.levels) &&
    value.levels.every(isLevelSummary) &&
    'nextCursor' in value &&
    (value.nextCursor === null || isCount(value.nextCursor))
  );
}
export function isNextLevelResponse(value: unknown): value is NextLevelResponse {
  if (typeof value !== 'object' || value === null || !('next' in value)) return false;
  const next = value.next;
  return (
    next === null ||
    (typeof next === 'object' &&
      'levelId' in next &&
      typeof next.levelId === 'string' &&
      'title' in next &&
      typeof next.title === 'string')
  );
}
