import {
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
  SEED_AUTHOR,
} from '../../shared/constants';
import type { LevelObject, LevelVersion } from '../../shared/types';

// Hand-authored placeholder levels (spec section 38, Phase 3: "two or three
// hand-authored test levels load and play correctly"). There's no editor
// yet, so these stand in for what Phase 4's editor will eventually publish
// — LevelService seeds them into Redis the first time each is requested,
// through the exact same storage path a real publish will use later.
const SEED_CREATED_AT = Date.UTC(2026, 0, 1);

function groundStrip(startX: number, widthPx: number): LevelObject[] {
  const tileCount = Math.round(widthPx / GRID_CELL_SIZE);
  const tiles: LevelObject[] = [];
  for (let i = 0; i < tileCount; i++) {
    tiles.push({
      id: `ground-${startX}-${i}`,
      type: 'ground',
      x: startX + i * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
      y: GROUND_TOP_Y,
      properties: {},
      addedBy: SEED_AUTHOR,
      addedInVersion: 1,
    });
  }
  return tiles;
}

function placed(
  id: string,
  type: LevelObject['type'],
  x: number,
  y: number
): LevelObject {
  return {
    id,
    type,
    x,
    y,
    properties: {},
    addedBy: SEED_AUTHOR,
    addedInVersion: 1,
  };
}

function level(
  levelId: string,
  objects: LevelObject[],
  verificationTimeMs: number
): LevelVersion {
  return {
    levelId,
    version: 1,
    parentVersion: null,
    objects,
    contributorUsername: SEED_AUTHOR,
    verificationTimeMs,
    createdAt: SEED_CREATED_AT,
  };
}

// The default level: two gaps, two spikes.
//
// Ground/spike/saw/spawn/finish are all bottom-anchored objects that SIT ON
// the surface at GROUND_TOP_Y (ObjectRegistry.originFor: everything but
// 'solid' → origin 0.5,1), so they're all placed flush AT GROUND_TOP_Y —
// spawn included, so the run starts with the player already standing on
// the ground instead of hovering a tile above it and dropping into frame.
const meatGrinder = level(
  'meat-grinder',
  [
    ...groundStrip(0, 700),
    ...groundStrip(820, 580),
    ...groundStrip(1500, 500),
    ...groundStrip(2110, 1090),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y),
    placed('spike-1', 'spike', 1100, GROUND_TOP_Y),
    placed('spike-2', 'spike', 1850, GROUND_TOP_Y),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y),
  ],
  9831
);

// Wider, more frequent gaps — tests jump-distance tuning independent of
// hazard placement.
const gapGauntlet = level(
  'gap-gauntlet',
  [
    ...groundStrip(0, 500),
    ...groundStrip(700, 300),
    ...groundStrip(1140, 300),
    ...groundStrip(1580, 300),
    ...groundStrip(2020, 300),
    // A 360px gap — wider than the ~179px a straight jump covers at this
    // run speed/gravity, so the moving platform below is load-bearing, not
    // decorative: catch it near the left edge, ride it, hop off near the
    // right edge.
    ...groundStrip(2680, 700),
    placed('moving-platform-1', 'movingPlatform', 2420, GROUND_TOP_Y),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y),
    placed('double-jump-1', 'doubleJump', 300, GROUND_TOP_Y - 60),
    placed('finish-1', 'finish', 3280, GROUND_TOP_Y),
  ],
  11204
);

// A raised platform, a saw, a moving saw, and a couple of power-ups, to
// prove the ObjectRegistry generalizes beyond spikes/ground (and, later,
// that Phase 8's power-ups/moving hazards do too).
const sawAlley = level(
  'saw-alley',
  [
    ...groundStrip(0, 900),
    placed('platform-1', 'platform', 1050, GROUND_TOP_Y - 90),
    placed('platform-2', 'platform', 1170, GROUND_TOP_Y - 90),
    ...groundStrip(1300, 1900),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y),
    placed('auto-dash-1', 'autoDash', 500, GROUND_TOP_Y - 60),
    placed('saw-1', 'saw', 1900, GROUND_TOP_Y),
    placed('moving-saw-1', 'movingSaw', 2250, GROUND_TOP_Y),
    placed('shield-1', 'shield', 2450, GROUND_TOP_Y - 60),
    placed('spike-1', 'spike', 2600, GROUND_TOP_Y),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y),
  ],
  10556
);

export const SEED_LEVELS: Record<string, LevelVersion> = {
  [meatGrinder.levelId]: meatGrinder,
  [gapGauntlet.levelId]: gapGauntlet,
  [sawAlley.levelId]: sawAlley,
};
