export type DiscoverySort = 'new' | 'trending' | 'deadliest' | 'speedrun';
export type Difficulty =
  'UNRATED' | 'EASY' | 'NORMAL' | 'HARD' | 'CURSED' | 'NIGHTMARE';
export type LevelSummary = {
  levelId: string;
  title: string;
  creatorUsername: string;
  version: number;
  difficulty: Difficulty;
  attempts: number;
  clears: number;
  completionRate: number;
  worldRecordMs: number | null;
  createdAt: number;
  trendingScore: number;
};
export type DiscoveryResponse = { levels: LevelSummary[] };

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
    value.levels.every(isLevelSummary)
  );
}
