// Production transfer budgets include static imports, but not lazy Browse chunks.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = 'dist/client';
const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8'));
async function entryBytes(name) {
  const entry = Object.keys(manifest).find((key) => key.endsWith(name));
  assert.ok(entry, `Missing ${name} entry`);
  const visited = new Set();
  let bytes = 0;
  async function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    bytes += gzipSync(await readFile(join(root, chunk.file))).length;
    for (const dependency of chunk.imports ?? []) await visit(dependency);
  }
  await visit(entry);
  return bytes;
}
const splash = await entryBytes('splash.html');
const game = await entryBytes('game.html');
assert.ok(splash < 16 * 1024, `Splash JS exceeds 16 KiB gzip: ${splash}`);
assert.ok(game < 550 * 1024, `Game JS exceeds 550 KiB gzip: ${game}`);
const files = await readdir(root, { recursive: true });
assert.ok(!files.some((file) => file.endsWith('.map')), 'Client source maps must not ship');
console.log(`Production budgets passed: splash ${splash} bytes gzip; game ${game} bytes gzip.`);
