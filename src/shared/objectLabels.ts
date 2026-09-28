import type { ObjectType } from './types';

// Player-facing names follow the notebook art, not the internal type ids
// (which stay put so published levels keep loading).
const TYPE_LABELS: Partial<Record<ObjectType, string>> = {
  candle: 'Stapler',
  saw: 'Gear',
  movingSaw: 'Moving Gear',
  bat: 'Charger',
  ghost: 'Floater',
  fallingBlock: 'Falling Block',
  speedBoost: 'Speed Boost',
};

// Shared (client + server) by DeathPanel's "Killed by u/X's Saw" attribution and
// RealtimeToast's "u/X added a Saw" version-published notice — both need
// the same human-readable object-type text.
export function labelFor(type: ObjectType): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}
