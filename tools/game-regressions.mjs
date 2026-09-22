// Run after npm run build: node tools/game-regressions.mjs
// Exercises the built client with local API fixtures; no Reddit writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist/client');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
  assert.deepEqual(errors, []);
  console.log('Passed: movement retry determinism and physics reset; editor request locking, cancellation, and recovery.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
