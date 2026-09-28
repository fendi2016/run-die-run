import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CURSE_LOCKED_LEVEL_IDS,
  SEED_AUTHOR,
  STARTER_LEVEL_ID,
} from '../../shared/constants';
import type { LevelSummary } from '../../shared/discoveryApi';
import { SEED_LEVELS, SEED_TITLES } from '../core/seedLevels';
import { pickLevelOfTheDay } from '../core/dailyPick';

await test('First Blood is seeded, jump-only, and curse-locked', () => {
  const starter = SEED_LEVELS[STARTER_LEVEL_ID];
  assert.ok(starter);
  assert.equal(SEED_TITLES[STARTER_LEVEL_ID], 'First Blood');
  assert.ok(CURSE_LOCKED_LEVEL_IDS.has(STARTER_LEVEL_ID));
  assert.equal(
    starter.objects.some((o) => o.type === 'ghost' || o.type === 'bat' || o.type === 'movingSaw'),
    false,
    'no hazards that move or punish jumping'
  );
  assert.ok(starter.objects.every((o) => o.addedBy === SEED_AUTHOR));
  assert.equal(starter.objects.filter((o) => o.type === 'spawn').length, 1);
  assert.equal(starter.objects.filter((o) => o.type === 'finish').length, 1);
});

const summary = (levelId: string): LevelSummary => ({
  levelId, title: levelId, creatorUsername: 'someone', version: 1, difficulty: 'EASY',
  attempts: 10, clears: 5, completionRate: 0.5, worldRecordMs: null, createdAt: 0, trendingScore: 1,
});

await test('Level of the Day never features a curse-locked level', () => {
  const levels = [summary(STARTER_LEVEL_ID), summary('saw-hell')];
  assert.equal(pickLevelOfTheDay(levels, {})?.levelId, 'saw-hell');
  assert.equal(pickLevelOfTheDay([summary(STARTER_LEVEL_ID)], {}), undefined);
  // Falls back to the one featured longest ago, still skipping locked ones.
  assert.equal(
    pickLevelOfTheDay([summary(STARTER_LEVEL_ID), summary('a'), summary('b')], { a: '5', b: '3', [STARTER_LEVEL_ID]: '1' })?.levelId,
    'b'
  );
});
