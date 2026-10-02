import { isLevelVersion, type LevelVersion } from '../../shared/types';
import { withTimeout } from '../net';

// The post's level is fetched while the Preloader's asset bar is still
// filling (the menu doesn't wait for it), so GameScene can usually start it
// at once instead of waiting on the dark canvas. One-shot: GameScene
// takes it once; a prefetch older than MAX_AGE_MS (the player sat on the
// menu) is dropped so a curse published meanwhile isn't missed.
const MAX_AGE_MS = 60_000;

let pending:
  | { levelId: string; startedAt: number; level: Promise<LevelVersion | undefined> }
  | undefined;

export function prefetchLevel(levelId: string): void {
  const level = fetch(`/api/levels/${encodeURIComponent(levelId)}`, {
    signal: withTimeout(new AbortController().signal, 15000),
  })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      return isLevelVersion(body) ? body : undefined;
    })
    .catch(() => undefined);
  pending = { levelId, startedAt: Date.now(), level };
}

// Resolves to undefined when nothing usable was prefetched for this level
// (the caller then fetches normally).
export async function takePrefetchedLevel(
  levelId: string
): Promise<LevelVersion | undefined> {
  const taken = pending;
  pending = undefined;
  if (!taken || taken.levelId !== levelId) return undefined;
  if (Date.now() - taken.startedAt > MAX_AGE_MS) return undefined;
  return taken.level;
}
