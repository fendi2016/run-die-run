// The pencil must actually slide into the hole: it moves right past the
// mouth and the part drawn shrinks (clipped at the hole) before it hides.
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 700, y: 480 }, ...harness.groundTiles(20)]);
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  const samples = await page.evaluate(async () => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    const out = [];
    for (let i = 0; i < 300; i++) {
      const d = scene.children.list.find((o) => o.name === 'sharpener-dive');
      if (d && d.texture.key === 'player-dive' && d.visible) {
        const f = scene.finishSprite;
        out.push({ x: d.x, y: d.y, crop: d.isCropped ? d._crop.width : d.frame.width,
          mouthX: f.x - f.displayWidth * 0.38, mouthY: f.y - f.displayHeight * 0.73 });
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  });
  if (samples.length < 3) throw new Error(`dive barely shown: ${samples.length} samples`);
  // The arc may swing back first; the slide runs from its leftmost point.
  const first = samples.reduce((a, b) => (b.x < a.x ? b : a)), last = samples[samples.length - 1];
  if (last.x - first.x < 60) throw new Error(`pencil did not slide: x ${first.x} -> ${last.x}`);
  if (samples[0].crop < 290) throw new Error(`dive starts already cropped: ${samples[0].crop}`);
  if (Math.min(...samples.map((s) => s.crop)) > 150) throw new Error('pencil never went into the hole (never clipped)');
  const aimed = samples.find((s) => Math.abs(s.x - s.mouthX) < 6);
  if (!aimed || Math.abs(aimed.y - aimed.mouthY) > 6) throw new Error(`tip not at the mouth: ${JSON.stringify(aimed ?? first)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
