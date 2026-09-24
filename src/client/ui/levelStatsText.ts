import type { LevelStats } from '../../shared/discoveryApi';

// Shared by the feed card (splash) and the in-game menu so both describe a
// level the same way.
export function clearRateText(stats: LevelStats): string {
  if (stats.attempts === 0) return 'No runs yet';
  const rate = (stats.clears / stats.attempts) * 100;
  // One decimal under 10% — "1.6%" is the number that makes people try,
  // and rounding it to "2%" loses that.
  const shown =
    rate > 0 && rate < 10
      ? rate.toFixed(1).replace(/\.0$/, '')
      : String(Math.round(rate));
  return `${shown}% clear rate`;
}

export function versionText(stats: LevelStats): string {
  return stats.version > 1 ? `Cursed ${stats.version - 1}×` : 'Uncursed';
}
