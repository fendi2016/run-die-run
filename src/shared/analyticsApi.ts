// Wire contract for POST /api/analytics/event — the few things only the
// client knows. Deaths, clears, curses, publishes and tutorial completions
// are counted by the server routes that already handle them.
export const CLIENT_EVENTS = ['card', 'open', 'play', 'loadFailed', 'leave'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export const DEVICE_KINDS = ['mobile', 'desktop'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

// Where a player was when they first left the game (closed it or switched
// away) in a session.
export const LEAVE_PLACES = ['menu', 'tutorial', 'level', 'sabotage', 'build'] as const;
export type LeavePlace = (typeof LEAVE_PLACES)[number];

export type AnalyticsEventRequest = {
  event: ClientEvent;
  // Sent with 'card' and 'open': the player's device.
  device?: DeviceKind;
  // Sent with 'open', all in ms from page start: when the menu came up,
  // when the game's code finished downloading, and when the asset loading
  // began (so the report can say which part is slow).
  loadMs?: number;
  codeMs?: number;
  assetsStartMs?: number;
  // Sent with 'loadFailed': the asset key that wouldn't load.
  file?: string;
  // Sent with 'leave'.
  where?: LeavePlace;
  seconds?: number;
  deaths?: number;
  // How far through the current level they ever got, 0–100.
  progress?: number;
};

const FILE_KEY = /^[\w./-]{1,80}$/;

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

function isCount(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

export function isAnalyticsEventRequest(value: unknown): value is AnalyticsEventRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('event' in value) || !isOneOf(CLIENT_EVENTS, value.event)) return false;
  if ('device' in value && value.device !== undefined && !isOneOf(DEVICE_KINDS, value.device)) {
    return false;
  }
  if ('where' in value && value.where !== undefined && !isOneOf(LEAVE_PLACES, value.where)) {
    return false;
  }
  const fields: Record<string, unknown> = { ...value };
  for (const field of ['loadMs', 'codeMs', 'assetsStartMs', 'seconds', 'deaths']) {
    if (fields[field] !== undefined && !isCount(fields[field])) return false;
  }
  if ('progress' in value && value.progress !== undefined && !isCount(value.progress, 100)) {
    return false;
  }
  if (
    'file' in value &&
    value.file !== undefined &&
    (typeof value.file !== 'string' || !FILE_KEY.test(value.file))
  ) {
    return false;
  }
  return true;
}
