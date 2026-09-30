import {
  GRID_CELL_SIZE,
  GROUND_TOP_Y,
  SEED_AUTHOR,
  STARTER_LEVEL_ID,
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

// The default level: three gaps, three staplers, and a floater drifting
// well above the ground (only a threat if the player jumps into its band —
// it stays out of reach of a grounded player's ~68px-tall hitbox, so it
// punishes jumping here instead of rewarding it). Type ids are the old
// internal names (candle = Stapler, ghost = Floater, saw = Gear; see
// shared/objectLabels.ts); object ids stay as-is because stored per-object
// data is keyed by them.
//
// Ground/stapler/gear/spawn/finish are all bottom-anchored objects that SIT ON
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
    placed('candle-2', 'candle', 1100, GROUND_TOP_Y),
    placed('candle-3', 'candle', 1850, GROUND_TOP_Y),
    // Floater: drifts ±GHOST_AMPLITUDE_PX (50px) around y = GROUND_TOP_Y - 130, on
    // the long clear run-up to the finish.
    placed('ghost-1', 'ghost', 2400, GROUND_TOP_Y - 130),
    placed('finish-1', 'finish', 3100, GROUND_TOP_Y),
  ],
  9831
);

// The starter (STARTER_LEVEL_ID): jump-only, a long run-up before each
// obstacle, and a 120px gap a quick tap clears. Can't be cursed, so it
// stays this easy.
const firstBlood = level(
  STARTER_LEVEL_ID,
  [
    ...groundStrip(0, 1500),
    ...groundStrip(1620, 1680),
    placed('fb-spawn', 'spawn', 80, GROUND_TOP_Y),
    placed('fb-candle-1', 'candle', 600, GROUND_TOP_Y),
    placed('fb-candle-2', 'candle', 1080, GROUND_TOP_Y),
    placed('fb-shield', 'shield', 1860, GROUND_TOP_Y),
    placed('fb-saw-1', 'saw', 2160, GROUND_TOP_Y),
    placed('fb-candle-3', 'candle', 2640, GROUND_TOP_Y),
    placed('fb-finish', 'finish', 3180, GROUND_TOP_Y),
  ],
  6000
);

// The launch set: ten more built-in levels, so day one isn't every player
// cursing Meat Grinder. Each is Meat Grinder's course (same ground, gaps,
// staplers, floater and finish) with a few traps or power-ups added in its
// open stretches. Every one has been cleared by the playtest solver.
function meatGrinderPlus(levelId: string, extras: LevelObject[]): LevelVersion {
  return level(levelId, [...meatGrinder.objects, ...extras], meatGrinder.verificationTimeMs);
}
const add = (type: LevelObject['type'], x: number, y = GROUND_TOP_Y): LevelObject =>
  placed(`${type}-${x}`, type, x, y);
// Heights for the traps that don't sit on the ground.
const LOW = GROUND_TOP_Y - 60;
const HIGH = GROUND_TOP_Y - 120;

const paperCuts = meatGrinderPlus('paper-cuts', [
  add('spikes', 2650), add('spikes', 2900),
]);
const recess = meatGrinderPlus('recess', [
  add('shield', 1250), add('saw', 2650), add('saw', 2900),
]);
// Spikes hang just over the pencil's head: stay down under them.
const mindYourHead = meatGrinderPlus('mind-your-head', [
  add('ceilingSpikes', 1620, HIGH), add('ceilingSpikes', 1680, HIGH),
  add('ceilingSpikes', 2650, HIGH), add('ceilingSpikes', 2710, HIGH),
]);
const leapOfFaith = meatGrinderPlus('leap-of-faith', [
  add('wings', 1250), add('bat', 2650, LOW), add('spikes', 2900),
]);
// Boosts carry you into the gap and the staplers at speed.
const lateForClass = meatGrinderPlus('late-for-class', [
  add('speedBoost', 1250), add('speedBoost', 2250),
]);
const popQuiz = meatGrinderPlus('pop-quiz', [
  add('stopwatch', 1250), add('electricMine', 2650), add('spikeMine', 2900),
]);
// A mace's swing is at the same point every time the pencil reaches a given
// x (the run speed never changes), so the low one sits where that point
// leaves a fair gap; at x 2650 it was all but impossible.
const detention = meatGrinderPlus('detention', [
  add('mace', 1700, HIGH), add('candle', 2650), add('mace', 2850, LOW),
]);
const marginOfError = meatGrinderPlus('margin-of-error', [
  add('bat', 1250, LOW), add('bat', 2650, LOW), add('ghost', 2900, GROUND_TOP_Y - 180),
]);
// A bit of everyone's traps.
const groupProject = meatGrinderPlus('group-project', [
  add('bat', 1250, LOW), add('saw', 2650), add('spikeMine', 2900),
]);
const finalExam = meatGrinderPlus('final-exam', [
  add('bat', 1250, LOW), add('ceilingSpikes', 1620, HIGH), add('ceilingSpikes', 1680, HIGH),
  add('candle', 2650), add('mace', 2850, LOW),
]);

const LAUNCH_SET = [
  paperCuts, recess, mindYourHead, leapOfFaith, lateForClass, popQuiz,
  detention, marginOfError, groupProject, finalExam,
];

export const SEED_LEVELS: Record<string, LevelVersion> = {
  [meatGrinder.levelId]: meatGrinder,
  [firstBlood.levelId]: firstBlood,
  ...Object.fromEntries(LAUNCH_SET.map((l) => [l.levelId, l])),
};

// Built-in levels have no published metadata (that's written by the
// publish route), so their display titles live here — otherwise feed
// cards, Browse and post titles fell back to the raw id ("meat grinder").
export const SEED_TITLES: Record<string, string> = {
  [meatGrinder.levelId]: 'Meat Grinder',
  [firstBlood.levelId]: 'First Blood',
  [paperCuts.levelId]: 'Paper Cuts',
  [recess.levelId]: 'Recess',
  [mindYourHead.levelId]: 'Mind Your Head',
  [leapOfFaith.levelId]: 'Leap of Faith',
  [lateForClass.levelId]: 'Late for Class',
  [popQuiz.levelId]: 'Pop Quiz',
  [detention.levelId]: 'Detention',
  [marginOfError.levelId]: 'Margin of Error',
  [groupProject.levelId]: 'Group Project',
  [finalExam.levelId]: 'Final Exam',
};

export function levelDisplayTitle(levelId: string, publishedTitle: string | undefined): string {
  return publishedTitle ?? SEED_TITLES[levelId] ?? levelId.replaceAll('-', ' ');
}
