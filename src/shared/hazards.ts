import type { ObjectType } from './types';

// Object types that kill on contact — the "traps" a curse can add and the
// ones the course preview, curse suggestions and pass tracking care about.
export const HAZARD_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'candle', 'saw', 'movingSaw', 'bat', 'ghost', 'fallingBlock', 'spikes',
  'ceilingSpikes', 'spikeMine', 'electricMine', 'mace',
]);
