// npm run playtest -- [scenario.mjs] [--rebuild] [--headed] [--size=WxH] [--query=?level=x] [--shot=out.png]
//
// Builds only if client sources changed, opens game.html at MainMenu, then
// runs the scenario's default export with ({ page, errors, harness }). The
// scenario may live anywhere (e.g. a scratch dir); it gets Playwright via
// `page`, so it needn't resolve playwright itself. With no scenario, it
// just boots the game and reports page errors.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as harness from './harness.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? args.includes(`--${name}`);
const scenarioPath = args.find((a) => !a.startsWith('--'));
const [width, height] = String(flag('size') || '640x360').split('x').map(Number);

const scenario = scenarioPath ? await import(pathToFileURL(resolve(scenarioPath)).href) : {};
if (await harness.ensureBuild({ force: flag('rebuild') === true })) console.log('rebuilt dist/client');

const result = await harness.withGame({
  api: scenario.api,
  viewport: { width, height },
  query: typeof flag('query') === 'string' ? flag('query') : '',
  headed: flag('headed') === true,
}, async ({ page, errors }) => {
  const value = scenario.default ? await scenario.default({ page, errors, harness }) : undefined;
  const shot = flag('shot');
  if (typeof shot === 'string') await page.screenshot({ path: shot });
  return { value, errors };
});

if (result.value !== undefined) console.log(JSON.stringify(result.value, null, 2));
if (result.errors.length) {
  console.error('page errors:\n' + result.errors.join('\n'));
  process.exitCode = 1;
}
