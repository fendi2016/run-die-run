// Finish: the pencil dives into the sharpener (real player hidden), the
// gag plays with its sounds and spits the eraser, and a restart mid-dive
// cleans up.
export default async function ({ page, errors, harness }) {
  const level = [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 700, y: 480 }, ...harness.groundTiles(20)];
  const named = (name) => page.evaluate((name) => window.__PHASER_GAME__.scene.getScene('GameScene')
    .children.list.filter((o) => o.name === name && o.active).length, name);
  const sounds = [];
  for (const warp of [false, true]) {
    await harness.startLevel(page, level);
    await page.evaluate((warp) => {
      const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
      window.__SOUNDS__ = [];
      const play = scene.sound.play.bind(scene.sound);
      scene.sound.play = (key, cfg) => { window.__SOUNDS__.push(key); return play(key, cfg); };
      scene.onFinishReached(warp);
    }, warp);
    await page.waitForTimeout(700);
    if ((await named('sharpener-dive')) !== 1) throw new Error('no dive stand-in mid-animation');
    const hidden = await page.evaluate(() => !window.__PHASER_GAME__.scene.getScene('GameScene').player.sprite.visible);
    if (!hidden) throw new Error('real player still visible during dive');
    await page.waitForFunction(() => window.__SKETCHY_DIVE_INSIDE__ === true, null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    if ((await named('sharpener-eraser')) !== 1) throw new Error('no eraser spat out');
    sounds.push(...(await page.evaluate(() => window.__SOUNDS__)));
  }
  for (const k of ['sharpenGrind', 'sharpenSquelch', 'sharpenTwang'])
    if (!sounds.includes(k)) throw new Error(`missing sound ${k}`);
  // Restart mid-dive: nothing survives and the player is back.
  await harness.startLevel(page, level);
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').restartRun());
  await page.waitForTimeout(300);
  if ((await named('sharpener-dive')) + (await named('sharpener-eraser')) !== 0) throw new Error('dive leaked past restart');
  const back = await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').player.sprite.visible);
  if (!back) throw new Error('player not visible after restart');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
