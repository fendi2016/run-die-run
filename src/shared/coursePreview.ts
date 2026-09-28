import { GRID_CELL_SIZE } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelVersion, ObjectType } from './types';

// A level boiled down to what the feed card's course silhouette draws —
// small enough for the splash to fetch on every impression.
export type CoursePreview = {
  width: number;
  ground: [number, number][];
  platforms: { x: number; y: number }[];
  hazards: { x: number; y: number; type: ObjectType }[];
  spawnX: number;
  finishX: number;
};

export function buildCoursePreview(level: LevelVersion): CoursePreview {
  const half = GRID_CELL_SIZE / 2;
  const tiles = level.objects
    .filter((o) => o.type === 'ground')
    .map((o): [number, number] => [o.x - half, o.x + half])
    .sort((a, b) => a[0] - b[0]);
  const ground: [number, number][] = [];
  for (const [from, to] of tiles) {
    const last = ground.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else ground.push([from, to]);
  }
  const spawnX = level.objects.find((o) => o.type === 'spawn')?.x ?? 0;
  const finishX = level.objects.find((o) => o.type === 'finish')?.x ?? 0;
  const rightmost = Math.max(finishX + half, ...level.objects.map((o) => o.x + half));
  return {
    width: rightmost,
    ground,
    platforms: level.objects
      .filter((o) => o.type === 'platform' || o.type === 'movingPlatform')
      .map((o) => ({ x: o.x, y: o.y })),
    hazards: level.objects
      .filter((o) => HAZARD_TYPES.has(o.type))
      .map((o) => ({ x: o.x, y: o.y, type: o.type })),
    spawnX,
    finishX,
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null && 'x' in v && isFiniteNumber(v.x) && 'y' in v && isFiniteNumber(v.y);

export function isCoursePreview(value: unknown): value is CoursePreview {
  return (
    typeof value === 'object' && value !== null &&
    'width' in value && isFiniteNumber(value.width) &&
    'ground' in value && Array.isArray(value.ground) &&
    value.ground.every((s: unknown) => Array.isArray(s) && s.length === 2 && s.every(isFiniteNumber)) &&
    'platforms' in value && Array.isArray(value.platforms) && value.platforms.every(isPoint) &&
    'hazards' in value && Array.isArray(value.hazards) &&
    value.hazards.every((h: unknown) => isPoint(h) && 'type' in h && typeof h.type === 'string') &&
    'spawnX' in value && isFiniteNumber(value.spawnX) &&
    'finishX' in value && isFiniteNumber(value.finishX)
  );
}
