// Run after npm run build: node tools/game-regressions.mjs
// Exercises the built client with local API fixtures; no Reddit writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './playtest/harness.mjs';
import { testStageOne } from './stage-one-regressions.mjs';

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.url}/game.html`);
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));

  const movement = await page.evaluate(async () => {
    const game = window.__PHASER_GAME__;
    const objects = [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 },
      { id: 'finish', type: 'finish', x: 2000, y: 480 },
      // The bat has no patrol tween (it dashes once on sight), so it's not here.
      ...['movingSaw', 'ghost', 'movingPlatform'].map((type, i) => ({
        id: type, type, x: 400 + i * 200, y: 360,
      })),
    ].map((object) => ({ ...object, properties: {}, addedBy: 'test', addedInVersion: 1 }));
    game.scene.start('GameScene', {
      previewLevel: { levelId: 'test', version: 1, parentVersion: null, objects,
        contributorUsername: 'test', verificationTimeMs: 0, createdAt: 0 },
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scene = game.scene.getScene('GameScene');
    game.loop.sleep();
    const sample = () => scene.movingObjectTweens.map((tween) => {
      const sprite = tween.targets[0];
      return { x: sprite.x, y: sprite.y, bodyX: sprite.body.x, bodyY: sprite.body.y,
        velocityX: sprite.body.velocity?.x ?? 0 };
    });
    scene.restartRun();
    const start = sample();
    const advance = () => {
      for (const tween of scene.movingObjectTweens) { tween.update(0); tween.update(500); }
    };
    advance();
    const first = sample();
    for (const tween of scene.movingObjectTweens) { tween.timeScale = 0.3; tween.update(1700); }
    scene.restartRun();
    const retry = sample();
    advance();
    const second = sample();
    scene.player.freeze();
    game.loop.wake();
    return { start, retry, first, second };
  });
  assert.equal(movement.start.length, 3);
  assert.deepEqual(movement.retry, movement.start);
  assert.deepEqual(movement.second, movement.first);
  assert.notDeepEqual(movement.first, movement.start);

  await page.evaluate(() => window.__PHASER_GAME__.scene.start('EditorScene'));
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('EditorScene'));
  let release;
  let requests = 0;
  await page.route('**/api/publish/validate', async (route) => {
    requests++;
    await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ json: { status: 'ok', candidateToken: 'fixture' } }).catch(() => {});
  });
  await page.click('#editor-test');
  await page.waitForFunction(() => document.querySelector('#editor-tool-candle').disabled);
  const duringRequest = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('EditorScene');
    const before = scene.controller.getObjects();
    scene.currentTool = 'candle';
    scene.onBoardTileTap(null, { x: 5, y: 0 });
    void scene.handleTest();
    return { before, after: scene.controller.getObjects() };
  });
  assert.deepEqual(duringRequest.after, duringRequest.before);
  assert.equal(requests, 1);
  await page.click('#editor-exit');
  await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('MainMenu'));
  release();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  assert.equal(await page.evaluate(() => window.__PHASER_GAME__.scene.isActive('MainMenu')), true);
  await page.evaluate(() => window.__PHASER_GAME__.scene.start('EditorScene'));
  await page.waitForFunction(() => !document.querySelector('#editor-test').disabled);
  await page.unroute('**/api/publish/validate');
  await page.route('**/api/publish/validate', (route) => route.fulfill({ json: { status: 'error', errors: ['Invalid fixture'] } }));
  await page.click('#editor-test');
  await page.waitForFunction(() => document.querySelector('#editor-message').textContent === 'Invalid fixture');
  assert.equal(await page.isDisabled('#editor-test'), false);
  assert.equal(await page.isDisabled('#editor-tool-candle'), false);
  // A dense level still has a fixed number of static collision handlers.
  // Exercise actual overlap callbacks at a narrow mobile viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(async () => {
    const game = window.__PHASER_GAME__;
    const objects = [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 },
      { id: 'finish', type: 'finish', x: 30000, y: 480 },
      { id: 'pickup', type: 'shield', x: 300, y: 420 },
      { id: 'trap', type: 'candle', x: 600, y: 420 },
      ...Array.from({ length: 500 }, (_, i) => ({ id: `tile-${i}`, type: 'ground', x: 30 + i * 60, y: 480 })),
    ].map((object) => ({ ...object, properties: {}, addedBy: 'test', addedInVersion: 1 }));
    game.scene.start('GameScene', { previewLevel: {
      levelId: 'mobile', version: 1, parentVersion: null, objects,
      contributorUsername: 'test', verificationTimeMs: 0, createdAt: 0,
    }});
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scene = game.scene.getScene('GameScene');
    game.loop.sleep();
    const colliders = scene.physics.world.colliders.update();
    const check = () => colliders.forEach((collider) => collider.update());
    const pickup = scene.powerUpImages[0];
    scene.player.body.reset(300, 410);
    check();
    const collected = !pickup.body.enable && scene.player.hasShield;
    scene.restartRun();
    const restored = pickup.body.enable && !scene.player.hasShield;
    scene.player.body.reset(600, 410);
    check();
    const result = { colliders: colliders.length, collected, restored,
      died: scene.runEnded, width: game.scale.width, height: game.scale.height };
    game.loop.wake();
    return result;
  });
  assert.equal(mobile.colliders, 4);
  assert.equal(mobile.collected, true);
  assert.equal(mobile.restored, true);
  assert.equal(mobile.died, true);
  assert.equal(mobile.width, 390);
  assert.equal(mobile.height, 844);
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  phone.on('pageerror', (error) => errors.push(error.message));
  let failAsset = true;
  await phone.route('**/assets/player/player-idle.webp', (route) =>
    failAsset ? route.fulfill({ status: 503, body: '' }) : route.continue());
  await phone.goto(`${server.url}/game.html`);
  await phone.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Preloader');
    return scene?.failed && !scene.load.isLoading();
  });
  assert.equal(await phone.evaluate(() => window.__PHASER_GAME__.scene.isActive('MainMenu')), false);
  failAsset = false;
  await phone.touchscreen.tap(195, 470);
  await phone.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));
  assert.equal(await phone.evaluate(() => window.__PHASER_GAME__.textures.exists('player-idle')), true);
  await phone.close();
  // First Blood (the starter) must stay beatable with quick taps. Fixed
  // 60fps steps keep this deterministic; the shield absorbs the saw.
  // Mirrors SEED_LEVELS['first-blood'] in src/server/core/seedLevels.ts.
  const starterPage = await browser.newPage({ viewport: { width: 844, height: 390 } });
  starterPage.on('pageerror', (error) => errors.push(error.message));
  const fb = (id, type, x) => ({ id, type, x, y: 480, properties: {}, addedBy: 'sketchy-seed', addedInVersion: 1 });
  const fbObjects = [
    ...Array.from({ length: 25 }, (_, i) => fb(`g${i}`, 'ground', 30 + i * 60)),
    ...Array.from({ length: 28 }, (_, i) => fb(`h${i}`, 'ground', 1650 + i * 60)),
    fb('fb-spawn', 'spawn', 80), fb('fb-candle-1', 'candle', 600), fb('fb-candle-2', 'candle', 1080),
    fb('fb-shield', 'shield', 1860), fb('fb-saw-1', 'saw', 2160), fb('fb-candle-3', 'candle', 2640),
    fb('fb-finish', 'finish', 3180),
  ];
  await starterPage.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname === '/api/levels/first-blood'
      ? route.fulfill({ json: { levelId: 'first-blood', version: 1, parentVersion: null, objects: fbObjects,
        contributorUsername: 'sketchy-seed', verificationTimeMs: 1, createdAt: 0 } })
      : route.fulfill({ status: 404, body: '' }));
  await starterPage.goto(`${server.url}/game.html?level=first-blood`);
  await starterPage.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));
  await starterPage.evaluate(() => localStorage.setItem('sketchy:tutorial-done', '1'));
  await starterPage.click('#game-menu-play');
  await starterPage.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene')?.player);
  const starterRun = await starterPage.evaluate((plan) => {
    const game = window.__PHASER_GAME__;
    const scene = game.scene.getScene('GameScene');
    game.loop.sleep();
    scene.restartRun();
    let time = performance.now(), next = 0, release = -1;
    for (let frame = 0; frame < 60 * 20; frame++) {
      if (next < plan.length && scene.player.sprite.x >= plan[next]) {
        scene.events.emit('jumpdown');
        release = frame + 4; // a ~67ms tap
        next++;
      }
      if (frame === release) scene.events.emit('jumpup');
      time += 1000 / 60;
      game.step(time, 1000 / 60);
      if (scene.runEnded) break;
    }
    game.loop.wake();
    return { ended: scene.runEnded, cleared: !document.querySelector('#run-result').classList.contains('hidden') };
  }, [500, 980, 1470, 2540]);
  assert.deepEqual(starterRun, { ended: true, cleared: true }, 'First Blood is beatable with quick taps');
  await starterPage.close();

  // Hub post: tutorial -> First Blood -> Level of the Day. Level post:
  // straight to its level, with a warm-up offer after 8 early deaths
  // that comes back afterwards.
  const funnelLevel = (levelId) => ({ levelId, version: 1, parentVersion: null, contributorUsername: 'test',
    verificationTimeMs: 1, createdAt: 0, objects: levelId === 'first-blood' ? fbObjects : [
      fb('spawn', 'spawn', 90), fb('finish', 'finish', 900),
      ...Array.from({ length: 16 }, (_, i) => fb(`g${i}`, 'ground', 30 + i * 60)),
    ] });
  const funnelPage = async (query, tutorialDone) => {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/levels/%40today' || path === '/api/levels/@today') return route.fulfill({ json: funnelLevel('today-level') });
      const match = /^\/api\/levels\/([a-z-]+)$/.exec(path);
      if (match) return route.fulfill({ json: funnelLevel(match[1]) });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${server.url}/game.html${query}`);
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));
    if (tutorialDone) await page.evaluate(() => localStorage.setItem('sketchy:tutorial-done', '1'));
    await page.click('#game-menu-play');
    return page;
  };
  const levelIdOf = (page) => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId);
  const hub = await funnelPage('', false);
  await hub.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene')?.levelVersion?.levelId === 'tutorial');
  await hub.click('#editor-preview-back-btn');
  await hub.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'first-blood');
  await hub.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());
  await hub.waitForSelector('#run-result-next', { state: 'visible' });
  assert.equal(await hub.textContent('#run-result-next'), 'Next Level');
  assert.match(await hub.textContent('#run-result-next-status'), /Today/);
  assert.equal(await hub.isVisible('#run-result-curse-btn'), false, 'no curse on the starter');
  await hub.click('#run-result-next');
  await hub.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'today-level');
  await hub.close();

  const post = await funnelPage('?level=real', true);
  await post.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene')?.levelVersion?.levelId === 'real');
  const dieTimes = (n) => post.evaluate((n) => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    for (let i = 0; i < n; i++) { scene.restartRun(); scene.onPlayerDied(); }
  }, n);
  await dieTimes(7);
  assert.equal(await post.isVisible('#starter-offer'), false, 'no offer before 8 deaths');
  await dieTimes(1);
  await post.waitForSelector('#starter-offer', { state: 'visible' });
  await post.click('#starter-offer-btn');
  await post.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'first-blood');
  assert.equal(await levelIdOf(post), 'first-blood');
  await post.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());
  await post.waitForSelector('#run-result-next', { state: 'visible' });
  assert.equal(await post.textContent('#run-result-next'), 'Back to real');
  await post.click('#run-result-next');
  await post.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'real');
  await post.close();

  // A player's first curse is guided: three picks, glowing suggestions,
  // and placement still allowed anywhere. Anyone with a curse gets the
  // normal palette.
  const guidedLevel = funnelLevel('cursable');
  guidedLevel.objects = [fb('spawn', 'spawn', 90), fb('finish', 'finish', 2310),
    ...Array.from({ length: 40 }, (_, i) => fb(`g${i}`, 'ground', 30 + i * 60))];
  const cursePage = async (curses) => {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/levels/cursable') return route.fulfill({ json: guidedLevel });
      if (path === '/api/me/curses') return route.fulfill({ json: { curses } });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${server.url}/game.html`);
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));
    // From MainMenu itself, so its shutdown hides the menu overlay.
    await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('MainMenu').scene.start('CurseScene', { levelId: 'cursable' }));
    await page.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('CurseScene')?.baseLevel);
    return page;
  };
  const guidedPage = await cursePage([]);
  await guidedPage.waitForSelector('#curse-more-options', { state: 'visible' });
  const visibleTypes = await guidedPage.evaluate(() =>
    [...document.querySelectorAll('[id^="curse-type-"]')].filter((b) => !b.classList.contains('hidden')).map((b) => b.id).sort());
  assert.deepEqual(visibleTypes, ['curse-type-candle', 'curse-type-ghost', 'curse-type-saw']);
  assert.equal(await guidedPage.isVisible('#curse-category-hazard'), false);
  const suggestionCount = await guidedPage.evaluate(() => window.__PHASER_GAME__.scene.getScene('CurseScene').suggestions.length);
  assert.ok(suggestionCount >= 1 && suggestionCount <= 3, `suggestions: ${suggestionCount}`);
  await guidedPage.click('#curse-type-candle');
  const placed = await guidedPage.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('CurseScene');
    const taken = new Set(scene.suggestions.map((s) => s.x));
    const tileX = [...Array(38).keys()].find((i) => !taken.has(30 + i * 60) && i > 6);
    scene.onBoardTileTap({}, { x: tileX, y: 5 });
    return scene.pending;
  });
  assert.ok(placed, 'a non-suggested cell still takes the curse');
  await guidedPage.click('#curse-more-options');
  assert.equal(await guidedPage.isVisible('#curse-category-hazard'), true);
  await guidedPage.close();
  const veteranPage = await cursePage([{ objectId: 'o', levelId: 'x', levelTitle: 'X', type: 'saw', placedAt: 1,
    caught: 0, passed: 0, newCaught: 0, newPassed: 0 }]);
  await veteranPage.waitForTimeout(300);
  assert.equal(await veteranPage.isVisible('#curse-more-options'), false);
  assert.equal(await veteranPage.isVisible('#curse-category-hazard'), true);
  await veteranPage.close();

  // First Play on a device runs the tutorial; Skip remembers that and
  // carries on to the requested level, and later Plays go straight there.
  const fresh = await browser.newPage({ viewport: { width: 844, height: 390 } });
  fresh.on('pageerror', (error) => errors.push(error.message));
  const requested = [];
  const realLevel = { levelId: 'real', version: 1, parentVersion: null, contributorUsername: 'test',
    verificationTimeMs: 1, createdAt: 0, objects: [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 }, { id: 'finish', type: 'finish', x: 900, y: 480 },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `g${i}`, type: 'ground', x: 30 + i * 60, y: 480 })),
    ].map((object) => ({ ...object, properties: {}, addedBy: 'test', addedInVersion: 1 })) };
  await fresh.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === '/api/levels/real') return route.fulfill({ json: realLevel });
    return route.fulfill({ status: 404, body: '' });
  });
  await fresh.goto(`${server.url}/game.html?level=real`);
  await fresh.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));
  await fresh.click('#game-menu-play');
  await fresh.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene')?.levelVersion?.levelId === 'tutorial');
  assert.equal(await fresh.isVisible('#editor-preview-back-btn'), true);
  assert.equal(requested.includes('/api/levels/tutorial'), false, 'the tutorial is never fetched');
  await fresh.click('#editor-preview-back-btn');
  await fresh.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').tutorial === false);
  await fresh.waitForFunction(() => document.querySelector('#editor-preview-back').classList.contains('hidden'));
  assert.equal(await fresh.evaluate(() => localStorage.getItem('sketchy:tutorial-done')), '1');
  await fresh.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('GameScene').levelVersion?.levelId === 'real');
  await fresh.evaluate(() => window.__PHASER_GAME__.scene.start('MainMenu'));
  await fresh.click('#game-menu-play');
  await fresh.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('GameScene'));
  assert.equal(await fresh.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').tutorial), false);
  await fresh.close();


  // A real (non-preview) clear presents "Leave Your Curse" beside "Next
  // Level" once both async results land: the curse button only appears
  // after the run submission succeeds, Next only after the discovery
  // lookup resolves.
  {
    const resultLevel = {
      levelId: 'result-actions', version: 1, parentVersion: null,
      objects: [
        { id: 'spawn', type: 'spawn', x: 90, y: 480 },
        { id: 'finish', type: 'finish', x: 500, y: 480 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `ground-${i}`, type: 'ground', x: 30 + i * 60, y: 480 })),
      ].map((object) => ({ ...object, properties: {}, addedBy: 'test', addedInVersion: 1 })),
      contributorUsername: 'test', verificationTimeMs: 10000, createdAt: 0,
    };
    const summary = (id) => ({ levelId: id, title: id, creatorUsername: 'test', version: 1,
      difficulty: 'UNRATED', attempts: 0, clears: 0, completionRate: 0,
      worldRecordMs: null, createdAt: 0, trendingScore: 0 });
    await page.route('**/api/levels/*', (route) =>
      route.fulfill({ json: { ...resultLevel, levelId: new URL(route.request().url()).pathname.split('/').at(-1) } }).catch(() => {})
    );
    await page.route('**/api/discovery/levels?*', (route) =>
      route.fulfill({ json: { levels: ['result-actions', 'second'].map(summary), nextCursor: null } })
    );
    await page.route('**/api/discovery/next?*', (route) =>
      route.fulfill({ json: { next: { levelId: 'second', title: 'second' } } })
    );
    await page.route('**/api/runs', (route) => {
      const request = route.request().postDataJSON();
      return route.fulfill({ json: { timeMs: request.timeMs, rank: 1, personalBestMs: request.timeMs,
        isNewPersonalBest: true, worldRecordMs: request.timeMs, topTen: [], streak: 1,
        isNewStreakIncrease: true, currencyAwarded: 10, currencyBalance: 10 } }).catch(() => {});
    });
    const start = (id = 'result-actions') => page.evaluate((levelId) => {
      const game = window.__PHASER_GAME__;
      for (const scene of game.scene.getScenes(false)) {
        if (scene.sys.isActive() || scene.sys.isPaused()) game.scene.stop(scene.sys.settings.key);
      }
      game.scene.start('GameScene', { levelId });
    }, id);
    const ready = () => page.waitForFunction(() => !!window.__PHASER_GAME__.scene.getScene('GameScene').player);
    const finish = () => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());

    await start();
    await ready();
    await finish();
    await page.waitForSelector('#run-result-curse-btn', { state: 'visible' });
    await page.waitForSelector('#run-result-next', { state: 'visible' });
    assert.equal((await page.textContent('#run-result-curse-btn')).trim(), 'Leave Your Curse');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#run-result-next').scrollIntoViewIfNeeded();
    const [wideCurse, wideNext] = await Promise.all([
      page.locator('#run-result-curse-btn').boundingBox(),
      page.locator('#run-result-next').boundingBox(),
    ]);
    assert.ok(wideCurse && wideNext, 'both buttons have layout boxes at 844x390');
    assert.ok(Math.abs(wideCurse.y - wideNext.y) < 4, 'Leave Your Curse and Next Level share a row at 844x390');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#run-result-next').scrollIntoViewIfNeeded();
    const [tallCurse, tallNext] = await Promise.all([
      page.locator('#run-result-curse-btn').boundingBox(),
      page.locator('#run-result-next').boundingBox(),
    ]);
    assert.ok(tallCurse.x >= 0 && tallCurse.x + tallCurse.width <= 390, 'curse button stays on-screen at 390x844');
    assert.ok(tallNext.x >= 0 && tallNext.x + tallNext.width <= 390, 'next button stays on-screen at 390x844');

    await page.locator('#run-result-menu').scrollIntoViewIfNeeded();
    await page.click('#run-result-menu');
    await page.waitForFunction(() => window.__PHASER_GAME__.scene.isActive('MainMenu'));
    await page.setViewportSize({ width: 960, height: 540 });
    await page.unroute('**/api/levels/*');
    await page.unroute('**/api/discovery/levels?*');
    await page.unroute('**/api/discovery/next?*');
    await page.unroute('**/api/runs');
  }

  await testStageOne(page);
  assert.deepEqual(errors, []);
  console.log('Passed: movement retries; editor locking and recovery; mobile resize, dense-level collision groups, pickups, hazards, touch retry after an asset failure, a tap-only First Blood clear, and first-play tutorial routing.');
} finally {
  await browser?.close();
  await server.close();
}
