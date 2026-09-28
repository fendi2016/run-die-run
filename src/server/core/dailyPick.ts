import { CURSE_LOCKED_LEVEL_IDS } from '../../shared/constants';
import type { LevelSummary } from '../../shared/discoveryApi';

// Level of the Day: the top trending level never featured before, else the
// one featured longest ago. `featured` maps levelId -> the UTC day it was
// last featured. Curse-locked levels (the starter) are never featured.
export function pickLevelOfTheDay(
  levels: LevelSummary[],
  featured: Record<string, string>
): LevelSummary | undefined {
  const candidates = levels.filter((level) => !CURSE_LOCKED_LEVEL_IDS.has(level.levelId));
  return (
    candidates.find((level) => featured[level.levelId] === undefined) ??
    [...candidates].sort(
      (a, b) => Number(featured[a.levelId]) - Number(featured[b.levelId])
    )[0]
  );
}
