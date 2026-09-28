import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import {
  DEATH_BUCKET_PX,
  isReportDeathRequest,
  type DeathMarkersResponse,
} from '../../shared/deathsApi';
import {
  EDITOR_MAX_COLUMNS,
  FALL_DEATH_Y,
  GRID_CELL_SIZE,
} from '../../shared/constants';
import { levelDeathsKey, levelVersionKey } from '../core/redisKeys';
import { getCurrentLevelVersion } from '../services/LevelService';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const MAX_DEATH_X = EDITOR_MAX_COLUMNS * GRID_CELL_SIZE;
// FALL_DEATH_Y is the world-layout baseline gameplay already uses to
// trigger a fall death (shared/constants.ts) — a reported death's y can
// never legitimately fall below the ground by more than that, and never
// above 0 (off the top of the board), so it doubles as this route's sanity
// bound.
const MAX_DEATH_Y = FALL_DEATH_Y;

// How many buckets a level's death-marker overlay shows — plenty for a
// faint skull field without the response growing unbounded on a level
// that's been played to death (pun intended).
const DEATH_MARKERS_LIMIT = 60;

export const deaths = new Hono();

// Fired without blocking the death/restart loop, same as runs.ts's
// fall/trap-kill reports — this only grows a per-version death-position
// histogram for the client's skull overlay, never gates the instant
// respawn.
deaths.post('/', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to report a death' },
      401
    );
  }

  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid request body' },
      400
    );
  }
  if (!isReportDeathRequest(body)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid death report' },
      400
    );
  }
  const { levelId, version, x, y } = body;
  if (x < 0 || x > MAX_DEATH_X) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'x out of bounds' },
      400
    );
  }
  if (y < 0 || y > MAX_DEATH_Y) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'y out of bounds' },
      400
    );
  }

  const published = await getCurrentLevelVersion(levelId);
  if (
    !published ||
    version > published.version ||
    !(await redis.exists(levelVersionKey(levelId, version)))
  ) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Unknown published version' },
      404
    );
  }

  const bucketX = Math.floor(x / DEATH_BUCKET_PX);
  const bucketY = Math.floor(y / DEATH_BUCKET_PX);
  await redis.zIncrBy(
    levelDeathsKey(levelId, version),
    `${bucketX}:${bucketY}`,
    1
  );

  return c.json({ ok: true });
});

// Parses a `${bucketX}:${bucketY}` sorted-set member back into its bucket
// indices, or undefined if it isn't one — guards against any stale/foreign
// member ever ending up in this key rather than trusting Redis content.
function parseBucketMember(
  member: string
): { bucketX: number; bucketY: number } | undefined {
  const [xPart, yPart] = member.split(':');
  if (xPart === undefined || yPart === undefined) return undefined;
  const bucketX = Number(xPart);
  const bucketY = Number(yPart);
  if (!Number.isInteger(bucketX) || !Number.isInteger(bucketY)) return undefined;
  return { bucketX, bucketY };
}

// Top death buckets for one level version, highest count first, converted
// from bucket indices back to the bucket's center in world px so the
// client can draw a skull straight at that position.
deaths.get('/:levelId/:version', async (c) => {
  const levelId = c.req.param('levelId');
  const versionParam = c.req.param('version');
  const version = Number(versionParam);
  if (!Number.isInteger(version) || version < 1) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Invalid version' },
      400
    );
  }

  const topBuckets = await redis.zRange(
    levelDeathsKey(levelId, version),
    0,
    DEATH_MARKERS_LIMIT - 1,
    { by: 'rank', reverse: true }
  );

  const markers: DeathMarkersResponse['markers'] = [];
  for (const entry of topBuckets) {
    const parsed = parseBucketMember(entry.member);
    if (!parsed) continue;
    markers.push({
      x: parsed.bucketX * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2,
      y: parsed.bucketY * DEATH_BUCKET_PX + DEATH_BUCKET_PX / 2,
      count: entry.score,
    });
  }

  return c.json<DeathMarkersResponse>({ levelId, version, markers });
});
