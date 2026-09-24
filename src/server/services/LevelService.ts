import { redis } from '@devvit/web/server';
import { levelCurrentVersionKey, levelVersionKey } from '../core/redisKeys';
import { SEED_LEVELS } from '../core/seedLevels';
import { isLevelVersion, type LevelVersion } from '../../shared/types';

// Not an ObjectType any more — only still found in stored level data.
const RETIRED_SPIKE: string = 'spike';

// Writes a seed's own version blob into Redis, without touching the
// current-version pointer — shared by both places below that persist a
// seed on demand (a level never yet requested, and a version blob that
// went missing but whose pointer still points at this exact seed version).
async function persistSeedVersion(
  levelId: string,
  seed: LevelVersion
): Promise<void> {
  await redis.set(levelVersionKey(levelId, seed.version), JSON.stringify(seed));
}

// Fetches the currently-published version of a level.
//
// Known seed levels are written into Redis the first time they're
// requested and never again after that — once Phase 4's publish flow
// (routes/publish.ts) exists, a seed id could in principle be reused by a
// real creator, and always rewriting from SEED_LEVELS on every request
// would silently clobber that real published version with the seed
// fallback. Seed-only-if-missing is what makes real publishes durable.
export async function getCurrentLevelVersion(
  levelId: string
): Promise<LevelVersion | undefined> {
  const storedVersionRaw = await redis.get(levelCurrentVersionKey(levelId));

  if (storedVersionRaw === undefined) {
    const seed = SEED_LEVELS[levelId];
    if (!seed) {
      return undefined;
    }
    await persistSeedVersion(levelId, seed);
    await redis.set(levelCurrentVersionKey(levelId), String(seed.version));
    return seed;
  }

  const version = Number(storedVersionRaw);
  const raw = await redis.get(levelVersionKey(levelId, version));
  if (raw === undefined) {
    // The current-version pointer survived but its version blob didn't
    // (e.g. evicted). Only self-heal the exact case a seed can safely
    // reconstruct — the pointer still points at the seed's own original
    // version, meaning nothing has ever been published on top of it. A
    // later version's blob going missing can't be recovered from the
    // seed (it would silently roll the level back to version 1 and
    // orphan real curses), so that case still returns undefined honestly.
    const seed = SEED_LEVELS[levelId];
    if (seed && seed.version === version) {
      await persistSeedVersion(levelId, seed);
      return seed;
    }
    return undefined;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isLevelVersion(parsed)) {
    console.error(
      `Corrupt level version data at ${levelVersionKey(levelId, version)}`
    );
    return undefined;
  }
  return withoutRetiredTypes(parsed);
}

// The spike was retired; the candle took its place. Levels published
// before that still store 'spike' objects, so they're read back as candles
// (same id and position, so trap-kill attribution keeps working) rather
// than rendering nothing where a hazard used to be.
function withoutRetiredTypes(level: LevelVersion): LevelVersion {
  if (!level.objects.some((o) => o.type === RETIRED_SPIKE)) return level;
  return {
    ...level,
    objects: level.objects.map((o) =>
      o.type === RETIRED_SPIKE ? { ...o, type: 'candle' } : o
    ),
  };
}

// Overwrites every built-in level's *own* seed version blob (never the
// current-version pointer, and never any id outside SEED_LEVELS) with
// whatever seedLevels.ts currently says. `getCurrentLevelVersion`'s
// seed-only-if-missing rule means a source edit to a seed's LevelVersion
// (e.g. tuning a spawn/hazard position) never reaches an environment where
// that level was already requested at least once — this is the manual
// escape hatch for that, meant to be run from a moderator menu action
// during pre-launch tuning. Safe even after real publishes exist on top of
// a seed id: it only touches level:<id>:version:<seed.version>, which a
// later real publish's current-version pointer has already moved past.
export async function reseedBuiltInLevels(): Promise<string[]> {
  const seeds = Object.entries(SEED_LEVELS);
  await Promise.all(seeds.map(([levelId, seed]) => persistSeedVersion(levelId, seed)));
  return seeds.map(([levelId]) => levelId);
}
