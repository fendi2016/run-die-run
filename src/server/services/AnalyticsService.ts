import { redis } from '@devvit/web/server';
import type { DeviceKind } from '../../shared/analyticsApi';
import {
  analyticsActiveKey,
  analyticsCountsKey,
  analyticsDeviceKey,
  analyticsFirstSeenKey,
  analyticsLoadKey,
  analyticsNewKey,
  analyticsReturnsKey,
  analyticsStepKey,
} from '../core/redisKeys';

// Game-wide usage numbers for the moderator-only "Game stats" report.
// Everything is per UTC day in plain Redis (no outside service), and only
// usernames and counts are stored.
export const FUNNEL_STEPS = [
  'card', // saw the feed card
  'open', // opened the game
  'tutorial', // finished (or skipped) the tutorial
  'play', // started a run
  'death',
  'clear',
  'curse',
  'publish',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

const DAY_MS = 86_400_000;
const ANALYTICS_RETENTION_SECONDS = 90 * 86_400;
export const LOAD_BUCKETS = [
  { field: 'under2s', label: 'under 2s', maxMs: 2000 },
  { field: '2to4s', label: '2–4s', maxMs: 4000 },
  { field: '4to8s', label: '4–8s', maxMs: 8000 },
  { field: '8to15s', label: '8–15s', maxMs: 15000 },
  { field: 'over15s', label: 'over 15s', maxMs: Infinity },
] as const;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY_MS);
}

async function addUser(key: string, username: string, now: number): Promise<boolean> {
  const added = await redis.zAdd(key, { member: username, score: now });
  await redis.expire(key, ANALYTICS_RETENTION_SECONDS);
  return added > 0;
}

async function bump(key: string, field: string): Promise<void> {
  await redis.hIncrBy(key, field, 1);
  await redis.expire(key, ANALYTICS_RETENTION_SECONDS);
}

// First activity of the day: counts the player as active, as new if it's
// their first day ever, and as a day-1/day-7 return for the day they joined.
async function markActive(username: string, day: string, now: number): Promise<boolean> {
  if (!(await addUser(analyticsActiveKey(day), username, now))) return false;
  const firstSeen = await redis.get(analyticsFirstSeenKey(username));
  if (!firstSeen) {
    await redis.set(analyticsFirstSeenKey(username), day);
    await addUser(analyticsNewKey(day), username, now);
    return true;
  }
  const since = daysBetween(firstSeen, day);
  if (since === 1) await bump(analyticsReturnsKey(firstSeen), 'd1');
  if (since === 7) await bump(analyticsReturnsKey(firstSeen), 'd7');
  return true;
}

type TrackExtras = { device?: DeviceKind; loadMs?: number; now?: number };

// Records one funnel event. Logged-out viewers only add to the totals.
// Seeing the feed card doesn't make someone an active player.
export async function track(
  step: FunnelStep,
  username: string | undefined,
  extras: TrackExtras = {}
): Promise<void> {
  const now = extras.now ?? Date.now();
  const day = utcDay(now);
  await bump(analyticsCountsKey(day), step);
  if (step === 'open' && extras.loadMs !== undefined) {
    const bucket = LOAD_BUCKETS.find((b) => extras.loadMs !== undefined && extras.loadMs < b.maxMs);
    if (bucket) await bump(analyticsLoadKey(day), bucket.field);
  }
  if (!username) return;
  if (step !== 'card') await markActive(username, day, now);
  const firstTodayForStep = await addUser(analyticsStepKey(day, step), username, now);
  if (step === 'open' && firstTodayForStep && extras.device) {
    await bump(analyticsDeviceKey(day), extras.device);
  }
}

export async function trackLoadFailed(now = Date.now()): Promise<void> {
  await bump(analyticsLoadKey(utcDay(now)), 'failed');
}

// Analytics must never fail the gameplay request it rides on.
export async function trackSafely(
  step: FunnelStep,
  username: string | undefined,
  extras?: TrackExtras
): Promise<void> {
  try {
    await track(step, username, extras);
  } catch (error) {
    console.error(`analytics: failed to record ${step}: ${error}`);
  }
}

async function members(key: string): Promise<string[]> {
  const entries = await redis.zRange(key, 0, -1, { by: 'rank' });
  return entries.map((entry) => entry.member);
}

async function counts(key: string): Promise<Record<string, number>> {
  const raw = await redis.hGetAll(key);
  return Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, Number(v)]));
}

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

export type AnalyticsReport = {
  players: string;
  retention: string;
  funnel: string;
  activity: string;
  load: string;
};

// The last `days` UTC days (today included), as plain text sections.
export async function buildReport(days = 7, now = Date.now()): Promise<AnalyticsReport> {
  const dayList = Array.from({ length: days }, (_, i) => utcDay(now - i * DAY_MS));
  const short = (day: string): string => day.slice(5);

  const playerLines: string[] = [];
  const weekPlayers = new Set<string>();
  const totals: Record<string, number> = {};
  const load: Record<string, number> = {};
  const devices: Record<string, number> = {};
  for (const day of dayList) {
    const active = await members(analyticsActiveKey(day));
    for (const name of active) weekPlayers.add(name);
    const fresh = await redis.zCard(analyticsNewKey(day));
    const dayDevices = await counts(analyticsDeviceKey(day));
    playerLines.push(
      `${short(day)}  ${active.length} players · ${fresh} new · ` +
        `${dayDevices.mobile ?? 0} mobile / ${dayDevices.desktop ?? 0} desktop`
    );
    for (const [k, v] of Object.entries(await counts(analyticsCountsKey(day)))) totals[k] = (totals[k] ?? 0) + v;
    for (const [k, v] of Object.entries(await counts(analyticsLoadKey(day)))) load[k] = (load[k] ?? 0) + v;
    for (const [k, v] of Object.entries(dayDevices)) devices[k] = (devices[k] ?? 0) + v;
  }
  const players = [
    `${weekPlayers.size} different players in the last ${days} days.`,
    `Device split: ${pct(devices.mobile ?? 0, (devices.mobile ?? 0) + (devices.desktop ?? 0))} mobile.`,
    ...playerLines,
  ].join('\n');

  // Cohorts: players whose first day was N days ago. Day-1 needs a day to
  // pass, day-7 a week.
  const retentionLines: string[] = [];
  for (let ago = 1; ago <= 14; ago++) {
    const day = utcDay(now - ago * DAY_MS);
    const fresh = await redis.zCard(analyticsNewKey(day));
    if (fresh === 0) continue;
    const returns = await counts(analyticsReturnsKey(day));
    const d1 = `${returns.d1 ?? 0} (${pct(returns.d1 ?? 0, fresh)})`;
    const d7 = ago >= 7 ? `${returns.d7 ?? 0} (${pct(returns.d7 ?? 0, fresh)})` : 'not yet';
    retentionLines.push(`${short(day)}  ${fresh} new → next day ${d1} · day 7 ${d7}`);
  }
  const retention = retentionLines.length
    ? retentionLines.join('\n')
    : 'No new players in the last 14 days yet.';

  const stepLabels: Record<FunnelStep, string> = {
    card: 'Saw the feed card',
    open: 'Opened the game',
    tutorial: 'Finished the tutorial',
    play: 'Started a run',
    death: 'Died',
    clear: 'Cleared a level',
    curse: 'Placed a curse',
    publish: 'Published a level',
  };
  const funnelLines: string[] = [];
  let openers = 0;
  for (const step of FUNNEL_STEPS) {
    const unique = new Set<string>();
    for (const day of dayList) for (const name of await members(analyticsStepKey(day, step))) unique.add(name);
    if (step === 'open') openers = unique.size;
    const share = step === 'card' || step === 'open' ? '' : ` (${pct(unique.size, openers)} of openers)`;
    funnelLines.push(`${stepLabels[step]}: ${unique.size}${share}`);
  }
  const funnel = [
    `Signed-in players, last ${days} days. Feed card views incl. logged out: ${totals.card ?? 0}.`,
    ...funnelLines,
  ].join('\n');

  const attempts = (totals.death ?? 0) + (totals.clear ?? 0);
  const activity = [
    `Game opens: ${totals.open ?? 0}`,
    `Deaths: ${totals.death ?? 0} · Clears: ${totals.clear ?? 0}`,
    `Curses placed: ${totals.curse ?? 0} · Levels published: ${totals.publish ?? 0}`,
    `Attempts per player: ${weekPlayers.size ? (attempts / weekPlayers.size).toFixed(1) : '—'}`,
  ].join('\n');

  const loads = LOAD_BUCKETS.reduce((sum, b) => sum + (load[b.field] ?? 0), 0);
  const loadText = [
    `Time to the menu, ${loads} loads:`,
    ...LOAD_BUCKETS.map((b) => `${b.label}: ${load[b.field] ?? 0} (${pct(load[b.field] ?? 0, loads)})`),
    `Failed to load: ${load.failed ?? 0}`,
  ].join('\n');

  return { players, retention, funnel, activity, load: loadText };
}
