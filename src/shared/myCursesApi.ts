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
