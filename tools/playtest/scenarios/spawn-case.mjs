// First spawn climbs out of the pencil case; a tap skips to the end; a
// death retry scribbles in instead.
export default async function ({ page, errors, harness }) {
  const level = [{ type: 'spawn', x: 200, y: 480 }, { type: 'finish', x: 3000, y: 480 },
    { id: 'trap', type: 'spikes', x: 2800, y: 480 }, ...harness.groundTiles(60)];
  await page.evaluate(() => {
    const sound = window.__PHASER_GAME__.sound;
    window.__SOUNDS__ = [];
    const play = sound.play.bind(sound);
    sound.play = (key, cfg) => { window.__SOUNDS__.push(key); return play(key, cfg); };
  });
  const state = () => page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    return { emerge: scene.children.list.filter((o) => o.name === 'spawn-emerge' && o.active).length,
      visible: scene.player.sprite.visible };
  });
  await harness.startLevel(page, level);
  let s = await state();
  if (s.emerge !== 1 || s.visible) throw new Error(`not emerging at start: ${JSON.stringify(s)}`);
  await page.waitForTimeout(1500);
  s = await state();
  if (s.emerge !== 0 || !s.visible) throw new Error(`emerge did not finish: ${JSON.stringify(s)}`);
  if (!(await page.evaluate(() => window.__SOUNDS__.includes('spawnPop')))) throw new Error('no spawn pop sound');
  // Tapping mid-emerge skips straight to the player.
  await harness.startLevel(page, level);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  s = await state();
  if (s.emerge !== 0 || !s.visible) throw new Error(`tap did not skip: ${JSON.stringify(s)}`);
  // A death retry uses the quick scribble-in, not the case.
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onHazardHit('trap'));
  await page.waitForTimeout(1200);
  s = await state();
  if (s.emerge !== 0) throw new Error('retry climbed out of the case');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
