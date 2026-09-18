import { redis } from '@devvit/web/server';
import { levelCurrentVersionKey, levelVersionKey } from '../core/redisKeys';
import { SEED_LEVELS } from '../core/seedLevels';
import { isLevelVersion, type LevelVersion } from '../../shared/types';

async function seedIfKnown(levelId: string): Promise<LevelVersion | undefined> {
  const seed = SEED_LEVELS[levelId];
  if (!seed) {
    return undefined;
  }
  await redis.set(levelVersionKey(levelId, seed.version), JSON.stringify(seed));
  await redis.set(levelCurrentVersionKey(levelId), String(seed.version));
  return seed;
}

// Fetches the currently-published version of a level, seeding it from the
// hand-authored placeholders (spec section 38, Phase 3) the first time it's
// requested. Once the editor (Phase 4) exists, publishes go through this
// same `level:{id}:currentVersion` / `level:{id}:version:{n}` storage path
// instead of the seed fallback.
export async function getCurrentLevelVersion(
  levelId: string
): Promise<LevelVersion | undefined> {
  const storedVersionRaw = await redis.get(levelCurrentVersionKey(levelId));
  if (storedVersionRaw === undefined) {
    return seedIfKnown(levelId);
  }

  const version = Number(storedVersionRaw);
  const raw = await redis.get(levelVersionKey(levelId, version));
  if (raw === undefined) {
    return seedIfKnown(levelId);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isLevelVersion(parsed)) {
    console.error(
      `Corrupt level version data at ${levelVersionKey(levelId, version)}`
    );
    return undefined;
  }
  return parsed;
}
