import { GRID_CELL_SIZE, GROUND_TOP_Y } from '../../shared/constants';
import type { LevelObject, LevelVersion } from '../../shared/types';

// Hand-authored placeholder levels (spec section 38, Phase 3: "two or three
// hand-authored test levels load and play correctly"). There's no editor
// yet, so these stand in for what Phase 4's editor will eventually publish
// — LevelService seeds them into Redis the first time each is requested,
// through the exact same storage path a real publish will use later.
const SEED_AUTHOR = 'cursed_seed';
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
const meatGrinder = level(
  'meat-grinder',
  [
    ...groundStrip(0, 700),
    ...groundStrip(820, 580),
    ...groundStrip(1500, 500),
    ...groundStrip(2110, 1090),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y - 60),
    placed('spike-1', 'spike', 1100, GROUND_TOP_Y),
    placed('spike-2', 'spike', 1850, GROUND_TOP_Y),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y - 60),
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
    ...groundStrip(2460, 700),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y - 60),
    placed('finish-1', 'finish', 3060, GROUND_TOP_Y - 60),
  ],
  11204
);

// A raised platform and a saw, to prove the ObjectRegistry generalizes
// beyond spikes/ground.
const sawAlley = level(
  'saw-alley',
  [
    ...groundStrip(0, 900),
    placed('platform-1', 'platform', 1050, GROUND_TOP_Y - 90),
    placed('platform-2', 'platform', 1170, GROUND_TOP_Y - 90),
    ...groundStrip(1300, 1900),
    placed('spawn-1', 'spawn', 80, GROUND_TOP_Y - 60),
    placed('saw-1', 'saw', 1900, GROUND_TOP_Y),
    placed('spike-1', 'spike', 2600, GROUND_TOP_Y),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y - 60),
  ],
  10556
);

export const SEED_LEVELS: Record<string, LevelVersion> = {
  [meatGrinder.levelId]: meatGrinder,
  [gapGauntlet.levelId]: gapGauntlet,
  [sawAlley.levelId]: sawAlley,
};
