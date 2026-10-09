import type { LeavePlace } from '../shared/analyticsApi';
import { sendAnalyticsEvent } from './analytics';

// Reports, once per visit, where the player was the first time they closed
// or switched away from the game: which screen, how long they'd been in,
// how often they'd died, and how far into the current level they'd got.
// Scenes keep it current with the setters below.

let place: LeavePlace | undefined;
let deaths = 0;
// Furthest point reached in the current level, 0–100; undefined off-level.
let progress: number | undefined;
let reported = false;

export function setLeavePlace(where: LeavePlace): void {
  if (where !== place) progress = undefined;
  place = where;
}

export function noteLeaveDeath(): void {
  deaths++;
}

export function noteLeaveProgress(percent: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (progress === undefined || clamped > progress) progress = clamped;
}

// A new level starts its progress over.
export function resetLeaveProgress(): void {
  progress = 0;
}

function report(): void {
  if (reported || !place) return;
  reported = true;
  sendAnalyticsEvent({
    event: 'leave',
    where: place,
    seconds: Math.round(performance.now() / 1000),
    deaths,
    ...(progress !== undefined ? { progress } : {}),
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') report();
});
window.addEventListener('pagehide', report);
