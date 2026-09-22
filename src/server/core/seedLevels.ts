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

// The default level: two gaps, two spikes, plus one of each new Halloween
// hazard — a static candle, a bat patrolling at head height (must be jumped
// over, the same dodge a spike or movingSaw asks for), and a ghost drifting
// well above the ground (only a threat if the player jumps into its band —
// GROUND_TOP_Y - 80 stays out of reach of a grounded player's ~68px-tall
// hitbox, so it punishes jumping here instead of rewarding it).
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
    placed('candle-1', 'candle', 400, GROUND_TOP_Y),
    placed('spike-1', 'spike', 1100, GROUND_TOP_Y),
    // Patrols ±BAT_AMPLITUDE_PX (60px) around x=1250, so its sweep stays
    // clear of spike-1 behind it and the gap at x=1400 ahead of it.
    placed('bat-1', 'bat', 1250, GROUND_TOP_Y - 45),
    placed('spike-2', 'spike', 1850, GROUND_TOP_Y),
    // Drifts ±GHOST_AMPLITUDE_PX (50px) around y = GROUND_TOP_Y - 130, on
    // the long clear run-up to the finish.
    placed('ghost-1', 'ghost', 2400, GROUND_TOP_Y - 130),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y),
  ],
  9831
);

export const SEED_LEVELS: Record<string, LevelVersion> = {
  [meatGrinder.levelId]: meatGrinder,
};
