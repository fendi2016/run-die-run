import type { ObjectType } from '../../shared/types';

const TYPE_LABELS: Partial<Record<ObjectType, string>> = {
  spike: 'Spike',
  saw: 'Saw',
  movingSaw: 'Moving Saw',
  fallingBlock: 'Falling Block',
};

// Shared by DeathPanel's "Killed by u/X's Saw" attribution and
// RealtimeToast's "u/X added a Saw" version-published notice — both need
// the same human-readable object-type text.
export function labelFor(type: ObjectType): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}
