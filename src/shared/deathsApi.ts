// Wire contract for death markers (faint skulls the client draws where
// players have died on the current level version). X positions are
// bucketed rather than stored per-death so the sorted set stays small and
// cheap to grow on every death — the client only ever wants "roughly
// where", not an exact pixel trail.
export const DEATH_BUCKET_PX = 20;

export type ReportDeathRequest = {
  levelId: string;
  version: number;
  x: number;
  y: number;
};

export function isReportDeathRequest(
  value: unknown
): value is ReportDeathRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    value.levelId.length > 0 &&
    'version' in value &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    'x' in value &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    'y' in value &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

// A bucket's death count, already converted to the bucket's center in
// world px (spec: the client draws a skull there, not at the bucket edge).
export type DeathMarker = {
  x: number;
  y: number;
  count: number;
};

export type DeathMarkersResponse = {
  levelId: string;
  version: number;
  markers: DeathMarker[];
  // Kill counts of this version's traps that have earned a notoriety badge
  // (see trapNotoriety.ts), by object id. Traps below the first tier are
  // left out.
  trapKills: Record<string, number>;
};

function isDeathMarker(value: unknown): value is DeathMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number' &&
    'count' in value &&
    typeof value.count === 'number'
  );
}

export function isDeathMarkersResponse(
  value: unknown
): value is DeathMarkersResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    'version' in value &&
    typeof value.version === 'number' &&
    'markers' in value &&
    Array.isArray(value.markers) &&
    value.markers.every(isDeathMarker) &&
    'trapKills' in value &&
    typeof value.trapKills === 'object' &&
    value.trapKills !== null &&
    Object.values(value.trapKills).every((kills) => typeof kills === 'number')
  );
}
