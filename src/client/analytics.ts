import type { AnalyticsEventRequest, DeviceKind } from '../shared/analyticsApi';

// Fire-and-forget usage events (see server AnalyticsService). Never awaited
// and never surfaced: analytics must not slow or break the game.
export function sendAnalyticsEvent(body: AnalyticsEventRequest): void {
  try {
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // fetch itself unavailable — nothing to report.
  }
}

// Touch-first screens count as mobile (phones and tablets in the Reddit app
// or a mobile browser); a mouse/trackpad as desktop.
export function deviceKind(): DeviceKind {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}
