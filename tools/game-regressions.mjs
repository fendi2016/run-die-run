// Run after npm run build: node tools/game-regressions.mjs
// Exercises the built client with local API fixtures; no Reddit writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { testStageOne } from './stage-one-regressions.mjs';

const root = resolve('dist/client');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/game.html`);
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'));

  const movement = await page.evaluate(async () => {
    const game = window.__PHASER_GAME__;
    const objects = [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 },
      { id: 'finish', type: 'finish', x: 2000, y: 480 },
      ...['movingSaw', 'bat', 'ghost', 'movingPlatform'].map((type, i) => ({
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
  assert.equal(movement.start.length, 4);
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
  await page.waitForFunction(() => document.querySelector('#editor-tool-spike').disabled);
  const duringRequest = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('EditorScene');
    const before = scene.controller.getObjects();
    scene.currentTool = 'spike';
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
  assert.equal(await page.isDisabled('#editor-tool-spike'), false);
  // A dense level still has a fixed number of static collision handlers.
  // Exercise actual overlap callbacks at a narrow mobile viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(async () => {
    const game = window.__PHASER_GAME__;
    const objects = [
      { id: 'spawn', type: 'spawn', x: 90, y: 480 },
      { id: 'finish', type: 'finish', x: 30000, y: 480 },
      { id: 'pickup', type: 'doubleJump', x: 300, y: 420 },
      { id: 'trap', type: 'spike', x: 600, y: 420 },
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
    const collected = !pickup.body.enable && scene.player.hasDoubleJump;
    scene.restartRun();
    const restored = pickup.body.enable && !scene.player.hasDoubleJump;
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
  await phone.goto(`http://127.0.0.1:${server.address().port}/game.html`);
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
  await testStageOne(page);
  assert.deepEqual(errors, []);
  console.log('Passed: movement retries; editor locking and recovery; mobile resize, dense-level collision groups, pickups, hazards, and touch retry after an asset failure.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
