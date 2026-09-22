import assert from 'node:assert/strict';

// Exercise real DOM controls and scene lifetimes against delayed/failed APIs.
export async function testStageOne(page) {
  const level = {
    levelId: 'first', version: 1, parentVersion: null,
    contributorUsername: 'test', verificationTimeMs: 10000, createdAt: 0,
    objects: [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 },
      { id: 'finish', type: 'finish', x: 9000, y: 480 },
      { id: 'moving', type: 'movingSaw', x: 700, y: 150 },
      ...Array.from({ length: 155 }, (_, i) => ({ id: `ground-${i}`, type: 'ground', x: 30 + i * 60, y: 480 })),
    ].map((object) => ({ ...object, properties: {}, addedBy: 'test', addedInVersion: 1 })),
  };
  const summary = (id) => ({ levelId: id, title: id, creatorUsername: 'test', version: 1,
    difficulty: 'UNRATED', attempts: 0, clears: 0, completionRate: 0,
    worldRecordMs: null, createdAt: 0, trendingScore: 0 });
  let levelMode = 'failure';
  let releaseLevel;
  await page.route('**/api/levels/*', async (route) => {
    if (levelMode === 'delayed') await new Promise((resolve) => { releaseLevel = resolve; });
    if (levelMode === 'failure') await route.fulfill({ status: 503, json: {} });
    else await route.fulfill({ json: { ...level, levelId: new URL(route.request().url()).pathname.split('/').at(-1) } }).catch(() => {});
  });
  let discoveryMode = 'two';
  await page.route('**/api/discovery/levels?*', (route) =>
    route.fulfill(discoveryMode === 'failure' ? { status: 503, json: {} } : {
      json: { levels: (discoveryMode === 'two' ? ['first', 'second'] : ['first']).map(summary) },
    })
  );
  const start = async (id = 'first') => {
    await page.evaluate((levelId) => {
      const game = window.__PHASER_GAME__;
      for (const scene of game.scene.getScenes(false)) {
        if (scene.sys.isActive() || scene.sys.isPaused()) game.scene.stop(scene.sys.settings.key);
      }
      game.scene.start('GameScene', { levelId });
    }, id);
  };
  const ready = () => page.waitForFunction(() => !!window.__PHASER_GAME__.scene.getScene('GameScene').player);
  const finish = () => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());

  await start();
  await page.waitForFunction(() => document.querySelector('#gameplay-dialog-title').textContent === 'Could not load this level');
  assert.equal(await page.isVisible('#gameplay-retry-load'), true);
  levelMode = 'ok';
  await page.click('#gameplay-retry-load');
  await ready();
  assert.equal(await page.isVisible('#gameplay-dialog'), false);
  // Pause before start and restart must release the initial physics gate.
  await page.click('#gameplay-menu');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isPaused('GameScene'));
  await page.click('#gameplay-restart');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').player.sprite.x > 100);
  await page.click('#gameplay-menu');
  const snapshot = () => page.evaluate(() => {
    const s = window.__PHASER_GAME__.scene.getScene('GameScene');
    return { x: s.player.sprite.x, y: s.player.sprite.y, elapsed: s.runElapsedMs,
      hazard: s.movingObjectTweens[0].targets[0].x };
  });
  await page.screenshot({ path: '/tmp/cursed-stage1-pause.png' });
  const paused = await snapshot();
  await page.waitForTimeout(400);
  assert.deepEqual(await snapshot(), paused, 'pause freezes player, hazards, and score time');
  await page.keyboard.press('Space');
  // Space on focused Resume is a DOM click, not a gameplay jump.
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('GameScene'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isPaused('GameScene'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isPaused('GameScene')), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('GameScene'));
  // Simulate document visibility and page lifecycle events independently of focus.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isPaused('GameScene')), true);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.click('#gameplay-resume');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isPaused('GameScene')), true);
  await page.click('#gameplay-exit');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('MainMenu'));
  assert.equal(await page.isVisible('#gameplay-menu'), false);

  // Back while loading must cancel a late success, never resurrect a departed scene.
  levelMode = 'delayed';
  await start();
  await page.waitForFunction(() => document.querySelector('#gameplay-dialog-title').textContent === 'Loading level…');
  await page.click('#gameplay-exit');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('MainMenu'));
  releaseLevel();
  levelMode = 'ok';
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isActive('MainMenu')), true);

  let scoreMode = 'failure';
  const submissions = [];
  let releaseScore;
  await page.route('**/api/runs', async (route) => {
    const request = route.request().postDataJSON();
    submissions.push(request);
    if (scoreMode === 'delayed') await new Promise((resolve) => { releaseScore = resolve; });
    if (scoreMode === 'failure') await route.fulfill({ status: 503, json: {} });
    else await route.fulfill({ json: { timeMs: request.timeMs, rank: 1, personalBestMs: request.timeMs,
      isNewPersonalBest: true, worldRecordMs: request.timeMs, topTen: [], streak: 1,
      isNewStreakIncrease: true, currencyAwarded: 10, currencyBalance: 10 } }).catch(() => {});
  });
  await start();
  await ready();
  await finish();
  await page.waitForSelector('#run-result-save-retry', { state: 'visible' });
  scoreMode = 'ok';
  await page.click('#run-result-save-retry');
  await page.waitForFunction(() => document.querySelector('#run-result-save-status').textContent === 'Score saved.');
  assert.deepEqual(submissions[0], submissions[1], 'save retry reuses the exact clear and id');
  await page.waitForSelector('#run-result-next', { state: 'visible' });
  await page.click('#run-result-next');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'second');
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onPlayerDied());
  await page.click('#death-panel-browse');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('DiscoveryScene'));

  // A late score response from an earlier attempt must not add buttons to a new run.
  scoreMode = 'delayed';
  discoveryMode = 'one';
  await start();
  await ready();
  await finish();
  await page.waitForFunction(() => document.querySelector('#run-result-next-status').textContent.startsWith('No other levels'));
  assert.equal(await page.isVisible('#run-result-next'), false);
  await page.click('#run-result-retry-btn');
  releaseScore();
  scoreMode = 'ok';
  await page.waitForSelector('#run-result', { state: 'hidden' });
  assert.equal(await page.isVisible('#run-result'), false);
  assert.equal(await page.isVisible('#run-result-curse-btn'), false);

  discoveryMode = 'failure';
  await finish();
  await page.waitForFunction(() => document.querySelector('#run-result-next').textContent === 'Retry Next Level');
  discoveryMode = 'two';
  await page.click('#run-result-next');
  await page.waitForFunction(() => document.querySelector('#run-result-next').textContent === 'Next Level');

  // Result actions fit both phone orientations and remain reachable by scrolling.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#run-result-menu').scrollIntoViewIfNeeded();
    const bounds = await page.locator('#run-result-menu').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
    await page.screenshot({ path: `/tmp/cursed-stage1-results-${viewport.width}.png` });
  }
  await page.click('#run-result-menu');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('MainMenu'));

  // Preview navigation retains the draft and ignores verification arriving after exit.
  let releaseVerification;
  await page.route('**/api/publish/verify', async (route) => {
    await new Promise((resolve) => { releaseVerification = resolve; });
    await route.fulfill({ json: { status: 'ok' } }).catch(() => {});
  });
  await page.evaluate((previewLevel) => {
    const game = window.__PHASER_GAME__;
    for (const scene of game.scene.getScenes(false)) {
      if (scene.sys.isActive() || scene.sys.isPaused()) game.scene.stop(scene.sys.settings.key);
    }
    game.scene.start('GameScene', {
      previewLevel, candidateToken: 'preview', previewReturn: { kind: 'editor', objects: previewLevel.objects },
    });
  }, level);
  await ready();
  await finish();
  await page.waitForFunction(() => document.querySelector('#run-result-save-status').textContent === 'Verifying clear…');
  await page.click('#editor-preview-back-btn');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('EditorScene'));
  releaseVerification();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isActive('EditorScene')), true);
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('EditorScene').controller.getObjects().length), level.objects.length);
  console.log('Passed: stage 1 navigation, pause/lifecycle, loading recovery, safe score retries, next-level selection, mobile results, and stale response cancellation.');
}
