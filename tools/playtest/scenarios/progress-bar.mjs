// The in-run progress bar stays switched off (RunHud SHOW_PROGRESS_BAR).
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 3000, y: 480 }, ...harness.groundTiles(60)]);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  if (await page.isVisible('#run-hud-progress-row')) throw new Error('progress bar visible');
  if (!(await page.isVisible('#run-hud-attempt'))) throw new Error('attempt counter hidden');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
