// Wire contract for POST /api/analytics/event — the few things only the
// client knows. Deaths, clears, curses, publishes and tutorial completions
// are counted by the server routes that already handle them.
export const CLIENT_EVENTS = ['card', 'open', 'play', 'loadFailed'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

export const DEVICE_KINDS = ['mobile', 'desktop'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export type AnalyticsEventRequest = {
  event: ClientEvent;
  // Sent with 'open': the player's device, and ms from page start to the menu.
  device?: DeviceKind;
  loadMs?: number;
};

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

export function isAnalyticsEventRequest(value: unknown): value is AnalyticsEventRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('event' in value) || !isOneOf(CLIENT_EVENTS, value.event)) return false;
  if ('device' in value && value.device !== undefined && !isOneOf(DEVICE_KINDS, value.device)) {
    return false;
  }
  if (
    'loadMs' in value &&
    value.loadMs !== undefined &&
    (typeof value.loadMs !== 'number' || !Number.isFinite(value.loadMs) || value.loadMs < 0)
  ) {
    return false;
  }
  return true;
}
