import { redis } from '@devvit/web/server';
import { levelCurrentVersionKey, levelVersionKey } from '../core/redisKeys';
import { SEED_LEVELS } from '../core/seedLevels';
import { SEED_AUTHOR } from '../../shared/constants';
import { isLevelVersion, isObjectType, type LevelObject, type LevelVersion } from '../../shared/types';

// Not an ObjectType any more — only still found in stored level data.
const RETIRED_SPIKE: string = 'spike';

// Writes a seed's own version blob into Redis, without touching the
// current-version pointer — shared by the places below that persist a
// seed on demand (a level never yet requested, and a version blob that
// went missing but whose pointer still points at this exact seed version).
async function persistSeedVersion(
  levelId: string,
  seed: LevelVersion
): Promise<void> {
  await redis.set(levelVersionKey(levelId, seed.version), JSON.stringify(seed));
}

// One stored version of a level, as written (no read-time cleanup). A
// built-in level's own seed version comes from source.
export async function getLevelVersionAt(
  levelId: string,
  version: number
): Promise<LevelVersion | undefined> {
  const seed = SEED_LEVELS[levelId];
  if (seed && seed.version === version) return seed;
  const raw = await redis.get(levelVersionKey(levelId, version));
  if (raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return isLevelVersion(parsed) ? parsed : undefined;
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
  // A built-in level's own seed version always comes from source, so an
  // edit in seedLevels.ts reaches subreddits that stored the old copy.
  const seedSource = SEED_LEVELS[levelId];
  if (seedSource && seedSource.version === version) {
    // Runs and deaths check this blob exists before accepting a result, so
    // restore it if it went missing (e.g. evicted) before serving the seed.
    if (!(await redis.exists(levelVersionKey(levelId, version)))) {
      await persistSeedVersion(levelId, seedSource);
    }
    return seedSource;
  }
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
  return withoutRetiredTypes(withoutRemovedSeedObjects(parsed));
}

// Curses on a built-in level copy its seed objects forward, so a hazard
// later taken out of seedLevels.ts (Meat Grinder's charger) would live on
// in every cursed version. Drop seed-authored objects the seed no longer
// has; everything players added stays.
function withoutRemovedSeedObjects(level: LevelVersion): LevelVersion {
  const seed = SEED_LEVELS[level.levelId];
  if (!seed) return level;
  const seedIds = new Set(seed.objects.map((o) => o.id));
  const kept = level.objects.filter((o) => o.addedBy !== SEED_AUTHOR || seedIds.has(o.id));
  return kept.length === level.objects.length ? level : { ...level, objects: kept };
}

// The spike was retired; the candle took its place. Levels published
// before that still store 'spike' objects, so they're read back as candles
// (same id and position, so trap-kill attribution keeps working) rather
// than rendering nothing where a hazard used to be. Any other type that's no
// longer an ObjectType (e.g. the removed 'cannon') is dropped outright —
// isLevelVersion only checks `type` is a string, so without this a retired
// object would reach the client with a type nothing knows how to render.
function withoutRetiredTypes(level: LevelVersion): LevelVersion {
  if (level.objects.every((o) => o.type !== RETIRED_SPIKE && isObjectType(o.type))) {
    return level;
  }
  return {
    ...level,
    objects: level.objects
      .map((o): LevelObject => (o.type === RETIRED_SPIKE ? { ...o, type: 'candle' } : o))
      .filter((o) => isObjectType(o.type)),
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
