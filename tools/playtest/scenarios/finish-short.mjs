// The run ends with the pencil short of the sharpener — he never touches it
// before the dive carries him in.
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 700, y: 480 }, ...harness.groundTiles(20)]);
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  const at = await page.evaluate(async () => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    for (let i = 0; i < 600; i++) {
      if (scene.runEnded) {
        const f = scene.finishSprite;
        return { pencilRight: scene.player.sprite.body.right, sharpenerLeft: f.x - f.displayWidth / 2 };
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    return undefined;
  });
  if (!at) throw new Error('never finished');
  if (at.pencilRight >= at.sharpenerLeft) throw new Error(`pencil touched the sharpener: ${JSON.stringify(at)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return `ok ${JSON.stringify(at)}`;
}
