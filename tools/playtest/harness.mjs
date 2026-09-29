// Headless playtest harness for the built client. `devvit playtest` needs
// Reddit auth and the devvit Vite plugin has no dev server, so this serves
// dist/client statically with stubbed /api/* JSON and drives it with
// Playwright through window.__PHASER_GAME__. See tools/playtest/run.mjs.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist/client');
const BUILD_INPUTS = ['src/client', 'src/shared', 'public', 'vite.config.ts', 'package-lock.json'];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

async function newestMtime(path) {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;
  const entries = await readdir(path);
  const times = await Promise.all(entries.map((entry) => newestMtime(join(path, entry))));
  return Math.max(info.mtimeMs, ...times);
}

// Rebuilds only when a client input is newer than the last build; the
// Vite build is the most expensive step of a playtest.
export async function ensureBuild({ force = false } = {}) {
  const built = await newestMtime(join(DIST, 'game.html'));
  const inputs = Math.max(...(await Promise.all(BUILD_INPUTS.map((p) => newestMtime(join(ROOT, p))))));
  if (!force && built > inputs) return false;
  const result = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('vite build failed');
  return true;
}

// `api(pathname, url, body)` returns a JSON-able value to stub a route, or
// undefined for a 404. Response shapes must pass the client's is*Response
// guards in src/shared/*Api.ts, or the client silently ignores them.
export async function startServer({ api = () => undefined } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const json = await api(url.pathname, url, body ? JSON.parse(body) : undefined);
      res.writeHead(json === undefined ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json ?? { status: 'error', message: 'not stubbed' }));
      return;
    }
    const file = resolve(DIST, `.${url.pathname === '/' ? '/game.html' : url.pathname}`);
    if (!file.startsWith(`${DIST}/`)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Opens game.html at MainMenu, runs `fn`, and always tears down the browser
// and server so no Chromium or Node process outlives the test.
export async function withGame(options, fn) {
  const { api, viewport = { width: 640, height: 360 }, query = '', headed = false } = options;
  const server = await startServer({ api });
  const browser = await chromium.launch({ headless: !headed, args: ['--mute-audio'] });
  const cleanup = () => { server.close(); void browser.close().finally(() => process.exit(130)); };
  process.once('SIGINT', cleanup);
  try {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${server.url}/game.html${query}`);
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.isActive('MainMenu'), null, { timeout: 30000 });
    return await fn({ page, errors });
  } finally {
    process.off('SIGINT', cleanup);
    await browser.close();
    server.close();
  }
}

// Fills in the bookkeeping fields every level object needs.
export function levelObjects(objects) {
  return objects.map((o, i) => ({ id: o.id ?? `${o.type}-${i}`, properties: {}, addedBy: 'test', addedInVersion: 1, ...o }));
}

// Ground tiles along y=480; without them the player free-falls.
export function groundTiles(count, { x = 30, y = 480 } = {}) {
  return Array.from({ length: count }, (_, i) => ({ type: 'ground', x: x + i * 60, y }));
}

// Starts GameScene on a preview level from MainMenu (a top-level
// SceneManager.start would leave MainMenu running underneath).
export async function startLevel(page, objects) {
  await page.evaluate((objects) => {
    const previewLevel = { levelId: 'playtest', version: 1, parentVersion: null, objects,
      contributorUsername: 'test', verificationTimeMs: 0, createdAt: 0 };
    window.__PHASER_GAME__.scene.getScene('MainMenu').scene.start('GameScene', { previewLevel });
  }, levelObjects(objects));
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    return scene?.scene.isActive() && scene.player;
  });
}

// Headless Chromium manages ~10fps and Phaser clamps delta, so real-time
// waits are meaningless. Pause the loop and advance exact frames instead.
// A paused loop can't process scene.start, so start scenes before pausing.
export async function pause(page) {
  await page.evaluate(() => {
    window.__PHASER_GAME__.loop.sleep();
    window.__PT_NOW__ = performance.now();
  });
}

export async function step(page, frames = 1, dt = 1000 / 60) {
  await page.evaluate(([frames, dt]) => {
    const game = window.__PHASER_GAME__;
    for (let i = 0; i < frames; i++) game.step((window.__PT_NOW__ += dt), dt);
  }, [frames, dt]);
}

export async function resume(page) {
  await page.evaluate(() => window.__PHASER_GAME__.loop.wake());
}
