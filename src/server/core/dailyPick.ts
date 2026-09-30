import { CURSE_LOCKED_LEVEL_IDS } from '../../shared/constants';

// Level of the Day: the top trending level never featured before, else the
// one featured longest ago. `levelIds` is in trending order; `featured`
// maps levelId -> the UTC day it was last featured. Curse-locked levels
// (the starter) are never featured.
export function pickLevelOfTheDay(
  levelIds: readonly string[],
  featured: Record<string, string>
): string | undefined {
  const candidates = levelIds.filter((levelId) => !CURSE_LOCKED_LEVEL_IDS.has(levelId));
  return (
    candidates.find((levelId) => featured[levelId] === undefined) ??
    [...candidates].sort((a, b) => Number(featured[a]) - Number(featured[b]))[0]
  );
}
