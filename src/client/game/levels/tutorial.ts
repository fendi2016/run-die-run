import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../../shared/types';

// The first-play tutorial: a short level that teaches the one control, one
// obstacle at a time (jump a candle, hold longer across a gap, stay low
// under a ghost, a quick double), then hands off to the level the player asked
// for. It lives on the client only — never published, so it can't be
// cursed, browsed, or show up on any stats — and plays like a preview run.
// Built by SEED_AUTHOR, so a death names no player.
export const TUTORIAL_LEVEL_ID = 'tutorial';

const TUTORIAL_DONE_KEY = 'cursed:tutorial-done';

// 240px: a quick tap always falls short, a held jump makes it with room to
// spare (checked in a headless timing sweep). 180px could be tapped across.
const GAP_START_X = 1260;
const GAP_END_X = 1500;
const LEVEL_END_X = 3060;

function object(id: string, type: ObjectType, x: number, y = GROUND_TOP_Y): LevelObject {
  return { id, type, x, y, properties: {}, addedBy: SEED_AUTHOR, addedInVersion: 1 };
}

function ground(fromX: number, toX: number): LevelObject[] {
  const tiles: LevelObject[] = [];
  for (let x = fromX; x < toX; x += GRID_CELL_SIZE) {
    tiles.push(object(`ground-${x}`, 'ground', x + GRID_CELL_SIZE / 2));
  }
  return tiles;
}

export const TUTORIAL_LEVEL: LevelVersion = {
  levelId: TUTORIAL_LEVEL_ID,
  version: 1,
  parentVersion: null,
  objects: [
    ...ground(0, GAP_START_X),
    ...ground(GAP_END_X, LEVEL_END_X),
    object('spawn', 'spawn', 80),
    object('candle-1', 'candle', 660),
    // Drifts in a band a grounded player passes under but a jump rises into.
    object('ghost-1', 'ghost', 1920, GROUND_TOP_Y - 130),
    object('candle-2', 'candle', 2340),
    object('candle-3', 'candle', 2580),
    object('finish', 'finish', 2940),
  ],
  contributorUsername: SEED_AUTHOR,
  verificationTimeMs: 0,
  createdAt: 0,
};

// Prompts shown while the player's x is inside [fromX, toX).
export const TUTORIAL_HINTS: { fromX: number; toX: number; text: string }[] = [
  { fromX: 0, toX: 680, text: 'Press and hold to jump the candle' },
  { fromX: 860, toX: GAP_END_X, text: 'Hold longer to jump farther' },
  { fromX: 1560, toX: 1980, text: "Don't jump! Let the ghost pass overhead" },
  { fromX: 2100, toX: 2600, text: 'Two in a row' },
  { fromX: 2680, toX: LEVEL_END_X, text: 'Reach the gate!' },
];

export function hintAt(x: number): string {
  return TUTORIAL_HINTS.find((hint) => x >= hint.fromX && x < hint.toX)?.text ?? '';
}

// Per-device: a player on a new device sees it once more, which is
// harmless (it's short and skippable). Storage can throw in private mode
// or previews — then it just counts as not done.
export function isTutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    // Not remembered; the player can skip it again next time.
  }
}
