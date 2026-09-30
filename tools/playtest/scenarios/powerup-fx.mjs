// Power-ups: each pickup pops, speed lines while boosted, the Stopwatch
// slows and tints moving objects and undoes both, one Star aura that ends
// with the Star.
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 6000, y: 480 },
    { id: 'saw', type: 'movingSaw', x: 900, y: 300 },
    // Phase-driven traps, far enough ahead that the runner never reaches them.
    { id: 'crusher', type: 'crusher', x: 4500, y: 480 }, { id: 'mace', type: 'mace', x: 4800, y: 480 },
    { id: 'zapper', type: 'electricMine', x: 5100, y: 480 }, ...harness.groundTiles(110)]);
  // Tint of each looping trap; the Zapper's only counts while it's on (off
  // it greys itself out).
  const cycleTints = () => page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    const find = (key) => scene.children.list.find((o) => o.texture?.key === key);
    const zapper = find('electric-mine');
    return { crusher: find('crusher')?.tintTopLeft, mace: find('mace-swing')?.tintTopLeft,
      zapper: zapper?.alpha === 1 ? zapper.tintTopLeft : 'off' };
  });
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
  const slowTints = await cycleTints();
  if (slowTints.zapper === 'off') throw new Error('zapper should be on early in its cycle');
  if (Object.values(slowTints).some((tint) => tint === 0xffffff || tint === undefined))
    throw new Error(`slowed trap not tinted: ${JSON.stringify(slowTints)}`);
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
  const afterTints = await cycleTints();
  if (Object.values(afterTints).some((tint) => tint !== 0xffffff && tint !== 'off'))
    throw new Error(`trap tint not undone: ${JSON.stringify(afterTints)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
