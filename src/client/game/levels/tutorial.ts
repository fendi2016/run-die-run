import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../../shared/types';

// The first-play tutorial: a short level that teaches the one control, one
// obstacle at a time (jump the stapler, hold longer across a gap, stay low
// under a floater, a quick double), then hands off to the level the player asked
// for. It lives on the client only — never published, so it can't be
// cursed, browsed, or show up on any stats — and plays like a preview run.
// Built by SEED_AUTHOR, so a death names no player.
export const TUTORIAL_LEVEL_ID = 'tutorial';

const TUTORIAL_DONE_KEY = 'cursed:tutorial-done';

// 240px: a quick tap only makes it from the very edge, a held jump has
// about three times the room (checked in a headless timing sweep).
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

// Prompts shown while the player's x is inside [fromX, toX). Text names the
// actual obstacle it points to — the object types render as the editor's
// hazards (candle -> Stapler, ghost -> Floater; see objectLabels.ts).
// `targetObjectId` (optional) is the id of the TUTORIAL_LEVEL object the
// hint is about, so GameScene's TutorialPointer knows what to point the
// Kenney hand at — undefined where a hint isn't about one placed object
// (the gap-jump hint spans open ground, not a hazard).
export type TutorialHintEntry = {
  fromX: number;
  toX: number;
  text: string;
  targetObjectId?: string;
};

export const TUTORIAL_HINTS: TutorialHintEntry[] = [
  { fromX: 0, toX: 680, text: 'Tap to jump over the stapler', targetObjectId: 'candle-1' },
  { fromX: 860, toX: GAP_END_X, text: 'Hold to jump farther' },
  {
    fromX: 1560,
    toX: 1980,
    text: "Don't jump! Let the floater pass overhead",
    targetObjectId: 'ghost-1',
  },
  {
    fromX: 2100,
    toX: 2600,
    text: 'Two staplers in a row',
    targetObjectId: 'candle-2',
  },
  { fromX: 2680, toX: LEVEL_END_X, text: 'Reach the gate!', targetObjectId: 'finish' },
];

function hintEntryAt(x: number): TutorialHintEntry | undefined {
  return TUTORIAL_HINTS.find((hint) => x >= hint.fromX && x < hint.toX);
}

export function hintAt(x: number): string {
  return hintEntryAt(x)?.text ?? '';
}

// The LevelObject the current hint is pointing at, if any — looked up by id
// against TUTORIAL_LEVEL's own fixed objects list rather than threading a
// live sprite reference through, since every tutorial hazard's x (and every
// non-ghost hazard's y) is authored, not runtime-computed; only the ghost
// bobs, and only on y (see ObjectRegistry's OSCILLATION_BY_TYPE), so its
// authored position is still the right thing to point a cosmetic hand at.
export function hintTargetAt(x: number): LevelObject | undefined {
  const targetId = hintEntryAt(x)?.targetObjectId;
  if (!targetId) return undefined;
  return TUTORIAL_LEVEL.objects.find((object) => object.id === targetId);
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
