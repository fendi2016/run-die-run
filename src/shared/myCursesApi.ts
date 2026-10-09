import { PLAYER_TRAP_LIFETIME_MS } from './editorApi';
import { isObjectType, type ObjectType } from './types';

// Wire contract for GET /api/me/curses: each curse the signed-in player
// has placed, how many unique players it caught and how many got past it,
// and how much of that is new since they last looked (POST /seen).
export type MyCurse = {
  objectId: string;
  levelId: string;
  levelTitle: string;
  type: ObjectType;
  placedAt: number;
  // Still in the level's current version: false once it expired, was
  // erased by another player's sabotage, or a mod removed it.
  live: boolean;
  caught: number;
  passed: number;
  newCaught: number;
  newPassed: number;
};

export type MyCursesResponse = { curses: MyCurse[] };

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function isMyCurse(value: unknown): value is MyCurse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objectId' in value && typeof value.objectId === 'string' &&
    'levelId' in value && typeof value.levelId === 'string' &&
    'levelTitle' in value && typeof value.levelTitle === 'string' &&
    'type' in value && isObjectType(value.type) &&
    'placedAt' in value && isCount(value.placedAt) &&
    'live' in value && typeof value.live === 'boolean' &&
    'caught' in value && isCount(value.caught) &&
    'passed' in value && isCount(value.passed) &&
    'newCaught' in value && isCount(value.newCaught) &&
    'newPassed' in value && isCount(value.newPassed)
  );
}

export function isMyCursesResponse(value: unknown): value is MyCursesResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'curses' in value &&
    Array.isArray(value.curses) &&
    value.curses.every(isMyCurse)
  );
}

// The menu's "while you were away" reveal: the curse that caught the most
// players since they last looked, and how many more catches the rest got.
// Undefined when nothing new was caught (passes alone aren't worth it).
export type CurseReveal = { curse: MyCurse; otherNewCaught: number };

export function pickCurseReveal(curses: readonly MyCurse[]): CurseReveal | undefined {
  let top: MyCurse | undefined;
  let total = 0;
  for (const curse of curses) {
    total += curse.newCaught;
    if (curse.newCaught > (top?.newCaught ?? 0)) top = curse;
  }
  return top ? { curse: top, otherNewCaught: total - top.newCaught } : undefined;
}

// How long the trap has left before the expire-traps job takes it out,
// or why it's already gone.
export function trapTimeLeft(curse: MyCurse, now = Date.now()): string {
  const left = curse.placedAt + PLAYER_TRAP_LIFETIME_MS - now;
  if (!curse.live) return left > 0 ? 'removed' : 'expired';
  if (left <= 0) return 'expiring now';
  const hours = Math.floor(left / 3_600_000);
  return hours >= 1 ? `${hours}h left` : `${Math.max(1, Math.ceil(left / 60_000))}m left`;
}
