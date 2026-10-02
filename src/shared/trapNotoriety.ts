// A trap that has killed enough players earns a badge drawn above it in
// the level, so everyone playing can see which traps are the dangerous
// ones (and whose they are). Counts are every death, like the feed card's
// deadliest trap, not unique players.
export type NotorietyTier = 1 | 2 | 3;

// Ascending: the highest threshold a trap has reached is its tier.
export const NOTORIETY_TIERS: readonly { tier: NotorietyTier; minKills: number }[] = [
  { tier: 1, minKills: 25 },
  { tier: 2, minKills: 100 },
  { tier: 3, minKills: 300 },
];

export const NOTORIETY_MIN_KILLS = 25;

export function notorietyTier(kills: number): NotorietyTier | undefined {
  let reached: NotorietyTier | undefined;
  for (const { tier, minKills } of NOTORIETY_TIERS) {
    if (kills >= minKills) reached = tier;
  }
  return reached;
}
