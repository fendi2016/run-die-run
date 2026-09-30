// Power-ups: each pickup pops, speed lines while boosted, the Stopwatch
// slows and tints moving objects and undoes both, one Star aura that ends
// with the Star.
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 6000, y: 480 },
    { id: 'saw', type: 'movingSaw', x: 900, y: 300 }, ...harness.groundTiles(110)]);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const state = await page.evaluate(async () => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    const keys = [];
    const add = scene.add.sprite.bind(scene.add);
    scene.add.sprite = (x, y, key, frame) => { keys.push(key); return add(x, y, key, frame); };
    for (const type of ['shield', 'speedBoost', 'wings', 'stopwatch', 'star', 'star'])
      scene.onPowerUpCollected(type, 300, 400);
    scene.add.sprite = add;
    const named = (n) => scene.children.list.filter((o) => o.name === n && o.active).length;
    const saw = scene.movingObjectTweens.flatMap((t) => t.targets).find((t) => t.texture?.key === 'saw-spin');
    await new Promise((r) => setTimeout(r, 600));
    return { pops: keys.filter((k) => k === 'shield-zap').length, auras: named('star-aura'),
      lines: named('speed-line'), sawTint: saw?.tintTopLeft, slowed: scene.movingObjectTweens[0]?.timeScale };
  });
  if (state.pops !== 6) throw new Error(`pops ${state.pops}`);
  if (state.auras !== 1) throw new Error(`star aura count ${state.auras}`);
  if (state.lines < 1) throw new Error('no speed lines while boosted');
  if (state.slowed >= 1) throw new Error('stopwatch did not slow');
  if (state.sawTint === 0xffffff || state.sawTint === undefined) throw new Error(`slowed saw not tinted: ${state.sawTint}`);
  await page.waitForTimeout(9000);
  const after = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    const saw = scene.movingObjectTweens.flatMap((t) => t.targets).find((t) => t.texture?.key === 'saw-spin');
    return { auras: scene.children.list.filter((o) => o.name === 'star-aura' && o.active).length,
      lines: scene.children.list.filter((o) => o.name === 'speed-line' && o.active).length,
      sawTint: saw?.tintTopLeft, slowed: scene.movingObjectTweens[0]?.timeScale };
  });
  if (after.auras !== 0) throw new Error('star aura outlived the Star');
  if (after.lines !== 0) throw new Error('speed lines outlived the boost');
  if (after.slowed !== 1 || after.sawTint !== 0xffffff) throw new Error(`slow not undone: ${JSON.stringify(after)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
