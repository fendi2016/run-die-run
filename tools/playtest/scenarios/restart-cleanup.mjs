// A quick retry leaves no old body on screen, and the Stopwatch's end
// effect never fires after the run is over.
export default async function ({ page, errors, harness }) {
  // 1. A quick retry must not leave the old body next to the new pencil.
  const level = [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 1500, y: 480 },
    { id: 'trap', type: 'spikes', x: 1400, y: 480 }, { id: 'sw', type: 'stopwatch', x: 1300, y: 400 },
    ...harness.groundTiles(30)];
  for (const type of ['spikes', 'mace', 'electricMine']) {
    level[2].type = type;
    await harness.startLevel(page, level);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onHazardHit('trap'));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').restartRun());
    await page.waitForTimeout(60);
    const bodies = await page.evaluate(() => {
      const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
      const own = [scene.player.sprite, scene.player.display];
      return scene.children.list.filter((o) => o.active && o.visible && o.alpha > 0 &&
        String(o.texture?.key).startsWith('player-') && !own.includes(o)).length;
    });
    if (bodies !== 0) throw new Error(`${type}: ${bodies} old body stand-in(s) after the restart`);
  }
  // 2. The Stopwatch's end-warp must not fire after the level is finished.
  await harness.startLevel(page, level);
  const warps = await page.evaluate(async () => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    scene.onPowerUpCollected('stopwatch', 300, 400);
    scene.onFinishReached(true);
    const keys = [];
    const add = scene.add.sprite.bind(scene.add);
    scene.add.sprite = (x, y, key, frame) => { keys.push(key); return add(x, y, key, frame); };
    await new Promise((r) => setTimeout(r, 5000));
    scene.add.sprite = add;
    return keys.filter((k) => k === 'time-warp').length;
  });
  if (warps !== 0) throw new Error(`stopwatch warp fired ${warps}x after the finish`);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
