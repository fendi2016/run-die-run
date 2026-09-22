import type { ObjectType } from './types';

// Devvit Realtime (spec section 29): live "new version published" / "new
// world record" notices, scoped to one channel per level so a player only
// hears about the level they're currently on. Shared between server (sends)
// and client (subscribes) so the channel-naming scheme and message shapes
// can't drift between the two sides.
//
// `@devvit/realtime`'s connectRealtime rejects any channel name containing
// anything but letters/digits/underscores (throws synchronously) — a level
// id is a slugified title (spec: `slugify()` produces lowercase words
// joined by hyphens, e.g. "meat-grinder"), so hyphens must be sanitized out
// or every subscribe attempt throws.
export const levelRealtimeChannel = (levelId: string): string =>
  `level_${levelId.replace(/[^a-zA-Z0-9_]/g, '_')}_events`;

export type VersionPublishedEvent = {
  type: 'versionPublished';
  levelId: string;
  version: number;
  authorUsername: string;
  addedType: ObjectType;
};

export type NewWorldRecordEvent = {
  type: 'newWorldRecord';
  levelId: string;
  username: string;
  timeMs: number;
};

export type RealtimeEvent = VersionPublishedEvent | NewWorldRecordEvent;

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  if (value.type === 'versionPublished') {
    return (
      'levelId' in value &&
      typeof value.levelId === 'string' &&
      'version' in value &&
      typeof value.version === 'number' &&
      'authorUsername' in value &&
      typeof value.authorUsername === 'string' &&
      'addedType' in value &&
      typeof value.addedType === 'string'
    );
  }
  if (value.type === 'newWorldRecord') {
    return (
      'levelId' in value &&
      typeof value.levelId === 'string' &&
      'username' in value &&
      typeof value.username === 'string' &&
      'timeMs' in value &&
      typeof value.timeMs === 'number'
    );
  }
  return false;
}
