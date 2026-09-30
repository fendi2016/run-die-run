// Every trap with its own death plays it (not the generic one), with its
// own sound, and leaves nothing behind.
export default async function ({ page, errors, harness }) {
  const sounds = { spikes: 'deathSpikes', ceilingSpikes: 'deathCeiling', spikeMine: 'deathMine',
    electricMine: 'deathZap', mace: 'deathMace', crusher: 'deathCrush', candle: 'deathStaple', bat: 'death', ghost: 'death' };
  for (const [type, sound] of Object.entries(sounds)) {
    await harness.startLevel(page, [
      { type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 1500, y: 480 },
      { id: 'trap', type, x: 1400, y: type === 'ceilingSpikes' ? 60 : 480 },
      ...harness.groundTiles(30),
    ]);
    // burstParticles keeps a small pool of emitters in the scene on purpose.
    const live = () => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene')
      .children.list.filter((o) => o.type !== 'ParticleEmitter' && o.texture?.key !== 'scribble-x').length);
    const before = await live();
    const played = await page.evaluate(() => {
      const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
      const keys = [];
      const play = scene.sound.play.bind(scene.sound);
      scene.sound.play = (key, cfg) => { keys.push(key); return play(key, cfg); };
      scene.onHazardHit('trap');
      scene.sound.play = play;
      return keys;
    });
    const peak = await live();
    await page.waitForTimeout(3000);
    const after = await live();
    if (peak <= before) throw new Error(`${type}: no effect objects spawned`);
    if (after > before) throw new Error(`${type}: ${after - before} effect objects leaked`);
    const own = await page.evaluate((t) => window.__SKETCHY_LAST_DEATH__ === t, type);
    if (!own) throw new Error(`${type}: fell back to the generic death`);
    if (!played.includes(sound)) throw new Error(`${type}: sound ${played} not ${sound}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
