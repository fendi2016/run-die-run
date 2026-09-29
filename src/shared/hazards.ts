import type { ObjectType } from './types';

// Object types that kill on contact — the "traps" a curse can add and the
// ones the course preview, curse suggestions and pass tracking care about.
// 'cannon' is deliberately excluded: the cannon body itself is solid (the
// player can stand on it), not lethal on contact — only the bullets it
// fires are, and those are runtime-only projectiles, never LevelObjects.
export const HAZARD_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'candle', 'saw', 'movingSaw', 'bat', 'ghost', 'fallingBlock', 'spikes',
  'ceilingSpikes', 'spikeMine', 'electricMine', 'mace', 'crusher',
]);
