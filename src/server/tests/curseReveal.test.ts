import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickCurseReveal, type MyCurse } from '../../shared/myCursesApi';
import { notorietyTier } from '../../shared/trapNotoriety';

const curse = (objectId: string, newCaught: number, newPassed = 0): MyCurse => ({
  objectId,
  levelId: 'pop-quiz',
  levelTitle: 'Pop Quiz',
  type: 'candle',
  placedAt: 1,
  caught: newCaught,
  passed: newPassed,
  newCaught,
  newPassed,
});

await test('the reveal picks the curse with the most new catches and totals the rest', () => {
  const reveal = pickCurseReveal([curse('a', 2), curse('b', 9), curse('c', 0, 5), curse('d', 3)]);
  assert.equal(reveal?.curse.objectId, 'b');
  assert.equal(reveal?.otherNewCaught, 5);
});

await test('no reveal when nothing new was caught, even with new passes', () => {
  assert.equal(pickCurseReveal([curse('a', 0, 4)]), undefined);
  assert.equal(pickCurseReveal([]), undefined);
});

await test('notoriety tiers start at 25 kills and top out at 300', () => {
  assert.equal(notorietyTier(24), undefined);
  assert.equal(notorietyTier(25), 1);
  assert.equal(notorietyTier(99), 1);
  assert.equal(notorietyTier(100), 2);
  assert.equal(notorietyTier(300), 3);
  assert.equal(notorietyTier(5000), 3);
});
