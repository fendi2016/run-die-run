# SKETCHY open items: deaths, power-up FX, menu art, sharpener finish, no progress bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five open pre-launch items: every trap gets its own death, power-ups get pack VFX, both menus show the current art, clearing a level feeds the pencil into the sharpener, and the in-run progress bar is switched off (kept in code).

**Architecture:** All five are client-only; no server or API changes. New effect art is repacked from the local Super Pixel Effects pack into `public/assets/vfx/*.webp` by one committed script and plugged into the existing `PIXEL_FX_SHEETS` / `playPixelFx` pipeline (`src/client/game/systems/Juice.ts`). Deaths extend `DEATH_EFFECT_BY_TYPE` in `DeathEffects.ts`. The finish replaces the victory dance with a stand-in pencil that slides into the sharpener's mouth. Menu art is recomposited from game sprites by a second committed script, keeping the pencil exactly where the current CSS layout expects him.

**Tech Stack:** Phaser 4.2.1, TypeScript, Vite, Python 3 + Pillow (asset scripts only), `cwebp`, Playwright via `npm run playtest`.

**Spec:** The user's request of 2026-09-29 (five items, quoted under "Scope" below). No separate spec doc.

## Scope (user's words)

1. per enemy death animations
2. Adding effects from the assets to the power ups
3. the art on both menus need to be updated with the new sprites i added
4. the animation for when you finish the level should be that the pencil gets inserted into the pencil sharpener at the end
5. remove the progress bar that is going during the level — don't delete it, remove it and make a note

## Decisions to confirm before starting (defaults in bold)

- **D1 — pencil pose for the sharpener dive:** **bake `player-idle` rotated 90° (tip pointing right) into a new texture `player-dive.webp`**; the alternative is the user drawing a dedicated horizontal "diving" pose. The texture is baked rotated rather than rotated at runtime because rotated player poses lost rectangular chunks in the headless harness (see `Player.ts` comment near `AIR_STRETCH_MAX`).
- **D2 — after the pencil is fully inside:** **it stays inside** (the result card is already up); alternative: it pops back out, sharpened.
- **D3 — victory dance:** **dropped from the finish**; its 9 frames stop loading (files stay in `public/assets/player/`).
- **D4 — menu art contents:** **notebook paper (the in-game `ui/paper-bg.webp`) + the four in-game clouds + a ground row of the new `paper/tiles/ground-*` tiles + the pencil + the pencil case (`markers/spawn.webp`) left of him + the sharpener (`markers/finish.webp`) at the far right**, no trees. Pencil at the exact same position and size as today.
- **D5 — hero pencil source:** **frame 1 of `~/Desktop/Assets/pencil sprites/idle.png`** (hands on hips, same pose as the current menu art, transparent). It's ~480 px tall and gets scaled up ~1.35× to match; if that looks soft, the user supplies a larger transparent pencil.
- **D6 — sounds:** **no new sounds in this pass** (trap deaths keep the generic crunch unless an entry is added to `DEATH_SFX_BY_TYPE`).

## Global Constraints

- Never mutate `x`/`y` on a live Arcade physics sprite for cosmetics (the player's `sprite`, the finish sensor). Animate stand-in images or the player's `display`, or tween scale only.
- The player's `display` sprite never rotates. Stand-in copies may rotate (existing bat/ghost deaths do).
- New pixel-art sheets are lossless WebP with `pixel: true` in `PIXEL_FX_SHEETS` (nearest filtering). Painted art is lossy WebP q88 / alpha 90 (`docs/production-performance.md`).
- Effects are one-shot and self-destroying, or owned and destroyed by whoever attached them (see `attachElectricShield`).
- Keep `npm run check:production` green (types, lint, unit tests, build, JS budgets: splash < 16 KiB gzip, game < 550 KiB gzip).
- Theme: scribble art + flashy/edgy VFX coexist; don't tone effects down to "match paper".
- Art is verified visually by the user, not by screenshots in tests. The harness checks behavior: no page errors, no leaked objects, timings.
- Stage explicit paths only (never `git add -A`); others edit this repo concurrently.

## Review Focus

- **Restart mid-animation:** tapping restart/Next while a death or the sharpener dive is still playing must not leave a stand-in, mask or tween behind, or show two pencils. Covered by the leak checks in Tasks 2 and 5.
- **Re-collecting a power-up while its effect is active** (Star twice, Stopwatch twice): no stacked loops, and the loop ends exactly when the power-up does. Covered in Task 3.
- **Finish reached from an odd spot** (dev warp, landing on top of the sharpener, reaching the sensor mid-air): the dive must still start from wherever the player is and end in the mouth. Covered in Task 5 (dev-warp case).
- **Portrait vs landscape menu** on the feed card and in the expanded view: the pencil must not move relative to the Play group. Covered in Task 4 (pixel-position check).
- **Death during a Star:** the Star makes traps harmless, so a trap death shouldn't happen; falling still kills and must use the generic death. Existing behavior, no new test.

---

### Task 1: Pack the new effect sheets

**Files:**
- Create: `tools/pack-fx.py`
- Create: `public/assets/vfx/{mine-explosion,zap-burst,whack-impact,crush-dust,shield-up,haste-burst,wings-burst,time-warp,star-sparkle}.webp`
- Modify: `src/client/game/systems/Juice.ts` (`PIXEL_FX_SHEETS`)

**Interfaces:**
- Produces: PIXEL_FX keys `mine-explosion`, `zap-burst`, `whack-impact`, `crush-dust` (Task 2); `shield-up`, `haste-burst`, `wings-burst`, `time-warp`, `star-sparkle` (Task 3). All loaded by the existing Preloader loop and animated by `createPixelFxAnims`.

- [ ] **Step 1: Write the packer.** It reads a pack `spritesheet.txt` (lines like `PNG/.../frame0003.png = X Y W H`), crops each frame in order and writes a clean horizontal strip.

```python
# tools/pack-fx.py — repack a Super Pixel Effects sheet into a clean strip.
# usage: python3 tools/pack-fx.py <pack sheet dir> <out key>
# Writes public/assets/vfx/<key>.webp (lossless) and prints the
# PIXEL_FX_SHEETS frame size and count.
import re, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

src_dir, key = Path(sys.argv[1]), sys.argv[2]
sheet = Image.open(src_dir / 'spritesheet.png').convert('RGBA')
rects = [tuple(map(int, m.groups())) for m in
         re.finditer(r'= (\d+) (\d+) (\d+) (\d+)', (src_dir / 'spritesheet.txt').read_text())]
w, h = rects[0][2], rects[0][3]
strip = Image.new('RGBA', (w * len(rects), h))
for i, (x, y, fw, fh) in enumerate(rects):
    strip.paste(sheet.crop((x, y, x + fw, y + fh)), (i * w, 0))
out = Path('public/assets/vfx') / f'{key}.webp'
with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
    strip.save(tmp.name)
    subprocess.run(['cwebp', '-quiet', '-lossless', tmp.name, '-o', str(out)], check=True)
print(f"{key}: frameWidth {w}, frameHeight {h}, frames {len(rects)} -> {out}")
```

- [ ] **Step 2: Pack the nine sheets.** From the repo root, with `P="$HOME/Desktop/Assets/Super Pixel Effects/spritesheet"`:

```bash
python3 tools/pack-fx.py "$P/Explosions/symmetrical_explosion_001/symmetrical_explosion_001_large_orange" mine-explosion
python3 tools/pack-fx.py "$P/Lightning/lightning_burst_001/lightning_burst_001_large_violet" zap-burst
python3 tools/pack-fx.py "$P/Impacts/symmetrical_impact_003/symmetrical_impact_003_large_yellow" whack-impact
python3 tools/pack-fx.py "$P/Smoke Bursts/symmetrical_smoke_burst_001/symmetrical_smoke_burst_001_large_brown" crush-dust
python3 tools/pack-fx.py "$P/Fantasy Spells/spell_defense_up_001/spell_defense_up_001_large_blue" shield-up
python3 tools/pack-fx.py "$P/Fantasy Spells/spell_haste_001/spell_haste_001_large_green" haste-burst
python3 tools/pack-fx.py "$P/Magic Bursts/round_light_burst_001/round_light_burst_001_large_yellow" wings-burst
python3 tools/pack-fx.py "$P/Sci-fi/scifi_warp_001/scifi_warp_001_large_green" time-warp
python3 tools/pack-fx.py "$P/Fantasy Spells/status_sparkling_001/status_sparkling_001_large_yellow" star-sparkle
```

Expected frame sizes: 64, 64, 96, 64, 128, 128, 256×144, 128, 96. If a printed size differs, use the printed one in Step 3.

- [ ] **Step 3: Register them.** Append to `PIXEL_FX_SHEETS` in `Juice.ts`, keeping the per-line source comments:

```ts
  // Trap deaths (DeathEffects) — Super Pixel Effects, pixel art
  { key: 'mine-explosion', frameWidth: 64, frameHeight: 64, frameRate: 20, pixel: true }, // symmetrical_explosion_001 orange
  { key: 'zap-burst', frameWidth: 64, frameHeight: 64, frameRate: 24, pixel: true }, // lightning_burst_001 violet
  { key: 'whack-impact', frameWidth: 96, frameHeight: 96, frameRate: 20, pixel: true }, // symmetrical_impact_003 yellow
  { key: 'crush-dust', frameWidth: 64, frameHeight: 64, frameRate: 20, pixel: true }, // symmetrical_smoke_burst_001 brown
  // Power-up pickups and auras (GameScene, Player) — Super Pixel Effects
  { key: 'shield-up', frameWidth: 128, frameHeight: 128, frameRate: 24, pixel: true }, // spell_defense_up_001 blue
  { key: 'haste-burst', frameWidth: 128, frameHeight: 128, frameRate: 30, pixel: true }, // spell_haste_001 green
  { key: 'wings-burst', frameWidth: 256, frameHeight: 144, frameRate: 20, pixel: true }, // round_light_burst_001 yellow
  { key: 'time-warp', frameWidth: 128, frameHeight: 128, frameRate: 20, pixel: true }, // scifi_warp_001 green
  { key: 'star-sparkle', frameWidth: 96, frameHeight: 96, frameRate: 20, pixel: true, loop: true }, // status_sparkling_001 yellow
```

- [ ] **Step 4: Verify they load and animate.** Write the scenario below to the scratchpad and run `npm run playtest -- <scratchpad>/fx-load.mjs --rebuild`. Expected: prints `ok` with every key's frame count > 1 and no page errors.

```js
export default async function ({ page, errors }) {
  const keys = ['mine-explosion','zap-burst','whack-impact','crush-dust','shield-up','haste-burst','wings-burst','time-warp','star-sparkle'];
  const frames = await page.evaluate((keys) => keys.map((k) =>
    [k, window.__PHASER_GAME__.anims.get(k)?.frames.length ?? 0]), keys);
  for (const [k, n] of frames) if (n < 2) throw new Error(`${k} has ${n} frames`);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
```

- [ ] **Step 5: Commit** `tools/pack-fx.py`, the nine webps and `Juice.ts`: "Pack trap-death and power-up effect sheets from Super Pixel Effects".

---

### Task 2: A death for every trap

**Files:**
- Modify: `src/client/game/systems/DeathEffects.ts` (six new `DeathEffect`s + `DEATH_EFFECT_BY_TYPE`)

**Interfaces:**
- Consumes: PIXEL_FX keys from Task 1; existing `playerStandIn`, `burstParticles`, `playPixelFx`, `playPlayerShatter`, `playBloodSplatter`.
- Produces: nothing new outside the file. `playDeathEffect(scene, killer, x, y, textureKey, displaySize)` is unchanged.

Traps that already have one: saw, movingSaw, candle (stapler), bat, ghost. Falls and `fallingBlock` (not placeable) keep `shatterAndExplode`.

- [ ] **Step 1: Write the failing scenario.** For each new type it builds a one-trap level, kills the player with that trap, steps 3 s of frames, and checks that the effect ran (a stand-in or FX appeared) and everything it spawned is gone again.

```js
// <scratchpad>/trap-deaths.mjs — run: npm run playtest -- <scratchpad>/trap-deaths.mjs --rebuild
export default async function ({ page, errors, harness }) {
  const types = ['spikes', 'ceilingSpikes', 'spikeMine', 'electricMine', 'mace', 'crusher'];
  for (const type of types) {
    await harness.startLevel(page, [
      { type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 1500, y: 480 },
      { id: 'trap', type, x: 600, y: type === 'ceilingSpikes' ? 60 : 480 },
      ...harness.groundTiles(30),
    ]);
    await harness.pause(page);
    // burstParticles keeps a small pool of emitters in the scene on purpose,
    // so they don't count as leaks.
    const live = () => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene')
      .children.list.filter((o) => o.type !== 'ParticleEmitter').length);
    const before = await live();
    await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onHazardHit('trap'));
    const peak = await live();
    await harness.step(page, 180);
    const after = await live();
    if (peak <= before) throw new Error(`${type}: no effect objects spawned`);
    if (after > before) throw new Error(`${type}: ${after - before} effect objects leaked`);
    const own = await page.evaluate((t) => window.__SKETCHY_LAST_DEATH__ === t, type);
    if (!own) throw new Error(`${type}: fell back to the generic death`);
    await harness.resume(page);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
```

Add the matching dev hook in `playDeathEffect` (plain window write, same pattern as `__PHASER_GAME__`):

```ts
  const own = killer !== undefined && DEATH_EFFECT_BY_TYPE[killer] !== undefined;
  // Read by the playtest scenarios to tell a trap's own death from the fallback.
  Reflect.set(window, '__SKETCHY_LAST_DEATH__', own ? killer : 'generic');
```

- [ ] **Step 2: Run it. It should fail** with `spikes: fell back to the generic death`.

- [ ] **Step 3: Implement the six deaths** in `DeathEffects.ts`, above `DEATH_EFFECT_BY_TYPE`:

```ts
const INK = 0x2b2b2b;
const SPARK_YELLOW = 0xffd23f;
const ZAP_VIOLET = 0xb07cff;

// Impaled from below: the body jolts up onto the points, sags, and a
// spray of red goes up past it.
const spikesImpale: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x, y - displaySize * 0.2, { scale: 2, angle: -90 });
  playBloodSplatter(scene, x, y - displaySize * 0.1, 1.5);
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: y - 18, scaleY: body.scaleY * 1.1, duration: 90, ease: 'Quad.easeOut' },
      { y: y + 10, scaleY: body.scaleY * 0.85, duration: 260, ease: 'Bounce.easeOut' },
      { alpha: 0, delay: 380, duration: 260 },
    ],
    onComplete: () => body.destroy(),
  });
};

// Pinned from above: squashed flat against the points, then drops.
const ceilingSpikesPin: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'blood-spray', x, y - displaySize, { scale: 2, angle: 90 });
  scene.cameras.main.shake(90, 0.005);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 0.7, scaleX: body.scaleX * 1.15, duration: 80, ease: 'Quad.easeOut' },
      { y: y + 260, alpha: 0, delay: 220, duration: 520, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

// Blown to bits: orange pixel explosion with the pose ripped into pieces.
const mineBlast: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  playPlayerShatter(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'mine-explosion', x, y - displaySize / 2, { scale: 3 });
  burstParticles(scene, x, y - displaySize / 2, INK, 18);
  scene.cameras.main.shake(160, 0.01);
};

// Electrocuted: the body strobes between white and a dark "x-ray" fill
// while jittering, violet lightning cracks around it, then it collapses.
const zapperFry: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setTintMode(Phaser.TintModes.FILL);
  let on = false;
  const strobe = scene.time.addEvent({
    delay: 50,
    repeat: 9,
    callback: () => {
      on = !on;
      body.setTint(on ? 0xffffff : INK);
      body.setX(x + (on ? 3 : -3));
    },
  });
  playPixelFx(scene, 'zap-burst', x, y - displaySize / 2, { scale: 2.5 });
  scene.time.delayedCall(180, () =>
    playPixelFx(scene, 'zap-burst', x, y - displaySize * 0.7, { scale: 1.8, angle: 90 })
  );
  burstParticles(scene, x, y - displaySize / 2, ZAP_VIOLET, 16);
  scene.cameras.main.shake(260, 0.004);
  scene.time.delayedCall(520, () => {
    strobe.remove();
    body.clearTint().setX(x);
    playPixelFx(scene, 'ash-smoke', x, y, { scale: 1.5, originY: 60 / 64 });
    scene.tweens.add({
      targets: body,
      scaleY: 0.01,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => body.destroy(),
    });
  });
};

// Whacked by the mace: star impact, then launched spinning up and away.
const maceWhack: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  body.setOrigin(0.5, 0.5).setY(y - displaySize / 2);
  playPixelFx(scene, 'whack-impact', x, y - displaySize / 2, { scale: 2 });
  burstParticles(scene, x, y - displaySize / 2, SPARK_YELLOW, 14);
  scene.cameras.main.shake(140, 0.009);
  scene.tweens.add({ targets: body, x: x - 320, angle: -720, duration: 1000, ease: 'Linear' });
  scene.tweens.chain({
    targets: body,
    tweens: [
      { y: body.y - 220, duration: 380, ease: 'Quad.easeOut' },
      { y: body.y + 320, alpha: 0, duration: 620, ease: 'Quad.easeIn' },
    ],
    onComplete: () => body.destroy(),
  });
};

// Flattened: a pancake on the ground with dust puffing out both sides.
const crusherFlatten: DeathEffect = (scene, x, y, textureKey, displaySize) => {
  const body = playerStandIn(scene, x, y, textureKey, displaySize);
  playPixelFx(scene, 'crush-dust', x - displaySize * 0.4, y, { scale: 1.6, originY: 1 });
  playPixelFx(scene, 'crush-dust', x + displaySize * 0.4, y, { scale: 1.6, originY: 1 });
  scene.cameras.main.shake(120, 0.012);
  scene.tweens.chain({
    targets: body,
    tweens: [
      { scaleY: body.scaleY * 0.12, scaleX: body.scaleX * 1.7, duration: 70, ease: 'Quad.easeIn' },
      { alpha: 0, delay: 600, duration: 300 },
    ],
    onComplete: () => body.destroy(),
  });
};
```

Then extend the table:

```ts
const DEATH_EFFECT_BY_TYPE: Partial<Record<ObjectType, DeathEffect>> = {
  saw: sawSlice,
  movingSaw: sawSlice,
  candle: candleBurn,
  bat: batKnockout,
  ghost: ghostSoulDrain,
  spikes: spikesImpale,
  ceilingSpikes: ceilingSpikesPin,
  spikeMine: mineBlast,
  electricMine: zapperFry,
  mace: maceWhack,
  crusher: crusherFlatten,
};
```

- [ ] **Step 4: Run the scenario again. Expected: `ok`.** Then `npm run type-check && npm run lint`.
- [ ] **Step 5: Hand to the user to watch each death** (they verify art; no screenshots). Tune scales/timings on their feedback.
- [ ] **Step 6: Commit** `DeathEffects.ts`: "A death of its own for spikes, ceiling spikes, spike mine, zapper, mace and crusher".

---

### Task 3: Pack effects on every power-up

**Files:**
- Modify: `src/client/game/scenes/GameScene.ts` (`onPowerUpCollected`, `slowTime`)
- Modify: `src/client/game/entities/Player.ts` (`grantStar`, star aura lifetime, `clearEffectSprites`, `syncVisuals`)
- Modify: `src/client/game/systems/Juice.ts` (new `attachStarSparkle`)

**Interfaces:**
- Consumes: Task 1 keys.
- Produces: `attachStarSparkle(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Sprite` in `Juice.ts`.

What changes, per power-up (the persistent effects that exist stay):

| Power-up | Pickup burst (at the pickup) | While active |
| --- | --- | --- |
| Shield | `shield-up` (was generic sparkle) | electric aura (unchanged) |
| Speed Boost | `haste-burst` (was generic flash) | hyperspeed trail (unchanged) |
| Wings | `wings-burst` (was generic sparkle) | wings sprite (unchanged) |
| Stopwatch | `time-warp` on pickup **and** again when slow time ends | camera flash (unchanged) |
| Star | `firework-yellow` (existing sheet) | new looping `star-sparkle` aura around the player, removed when the Star ends |

- [ ] **Step 1: Write the failing scenario.** It collects each power-up and checks the right burst key played, then checks the Star aura exists while the Star is active, is gone after it ends, and doesn't stack on re-collect.

```js
// <scratchpad>/powerup-fx.mjs
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 3000, y: 480 }, ...harness.groundTiles(60)]);
  await harness.pause(page);
  const played = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('GameScene');
    const keys = [];
    const add = scene.add.sprite.bind(scene.add);
    scene.add.sprite = (x, y, key, frame) => { keys.push(key); return add(x, y, key, frame); };
    for (const type of ['shield', 'speedBoost', 'wings', 'stopwatch', 'star', 'star'])
      scene.onPowerUpCollected(type, 300, 400);
    scene.add.sprite = add;
    const auras = scene.children.list.filter((o) => o.texture?.key === 'star-sparkle').length;
    return { keys, auras };
  });
  for (const k of ['shield-up', 'haste-burst', 'wings-burst', 'time-warp', 'firework-yellow'])
    if (!played.keys.includes(k)) throw new Error(`missing ${k}`);
  if (played.auras !== 1) throw new Error(`star aura count ${played.auras}`);
  await harness.step(page, 60 * 12); // longer than STAR and SLOW_TIME durations
  const left = await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene')
    .children.list.filter((o) => o.texture?.key === 'star-sparkle').length);
  if (left !== 0) throw new Error('star aura outlived the Star');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
```

- [ ] **Step 2: Run it. It should fail** with `missing shield-up`.

- [ ] **Step 3: Swap the pickup bursts** in `GameScene.onPowerUpCollected`:

```ts
      case 'shield':
        this.player.grantShield();
        playPixelFx(this, 'shield-up', x, y, { scale: 1.2 });
        break;
      case 'speedBoost':
        this.player.applySpeedBoost();
        playPixelFx(this, 'haste-burst', x, y, { scale: 1.2 });
        break;
      case 'wings':
        this.player.grantWings();
        playPixelFx(this, 'wings-burst', x, y, { scale: 0.9 });
        break;
      case 'stopwatch':
        this.slowTime();
        playPixelFx(this, 'time-warp', x, y, { scale: 1.4 });
        break;
      case 'star':
        this.player.grantStar();
        playPixelFx(this, 'firework-yellow', x, y, { scale: 1.2 });
        break;
```

In `slowTime()`, where the existing timer restores normal speed, play the warp once more on the player:

```ts
      playPixelFx(this, 'time-warp', this.player.sprite.x, this.player.sprite.y - PLAYER_SIZE / 2, { scale: 1 });
```

(guarded by `if (this.player)`; import `PLAYER_SIZE` if not already imported).

- [ ] **Step 4: Add the Star aura.** In `Juice.ts`:

```ts
// Looping sparkles around the player for as long as the Star lasts. Like
// attachElectricShield, the caller owns it: Player repositions it every
// frame and destroys it when the Star runs out.
export function attachStarSparkle(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  const sparkle = scene.add.sprite(x, y, 'star-sparkle', 0);
  sparkle.setScale(1.3);
  sparkle.play('star-sparkle');
  return sparkle;
}
```

In `Player.ts`, add `private starSprite: Phaser.GameObjects.Sprite | undefined;` next to `wingsSprite`. Then:

```ts
  grantStar(): void {
    this.invincibleRemainingMs = STAR_DURATION_MS;
    // Re-collecting refreshes the timer; one aura only.
    this.starSprite ??= attachStarSparkle(this.scene, this.sprite.x, this.sprite.y - PLAYER_SIZE / 2);
  }
```

Where `invincibleRemainingMs` hits 0 (the `if (this.invincibleRemainingMs === 0) this.display.clearTint();` line), also run `this.starSprite?.destroy(); this.starSprite = undefined;`. Add the same two statements to `clearEffectSprites()`, and position it in `syncEffectSprites` the same way the shield sprite is: `this.starSprite?.setPosition(this.sprite.x, centerY);`.

- [ ] **Step 5: Run the scenario. Expected: `ok`.** Then `npm run type-check && npm run lint`.
- [ ] **Step 6: User looks at each pickup.** Tune scales on their feedback.
- [ ] **Step 7: Commit** `GameScene.ts`, `Player.ts`, `Juice.ts`: "Pack VFX for every power-up: pickup bursts, stopwatch warp, star sparkle aura".

---

### Task 4: Menu art with the new sprites (feed card + expanded menu)

Both menus use the same two images through `src/client/menu.css`: `ui/menu-background.webp` (1672×941) and `ui/menu-background-portrait.webp` (900×1614). Replacing those two files updates both menus, which is how they stay matched.

**Files:**
- Create: `tools/compose-menu-art.py`
- Modify: `public/assets/ui/menu-background.webp`, `public/assets/ui/menu-background-portrait.webp`

**Interfaces:** none. CSS is untouched because the pencil keeps his position.

Pencil placement, measured from the current art (feet on the ground row, hands on hips). Landscape: pencil box ≈ x 280–575, y 180–825, ground top y ≈ 775. Portrait: pencil box ≈ x 295–605, y 660–1330, ground top y ≈ 1285, with a second ground row below it. Step 1's measurement confirms these numbers before composing.

- [ ] **Step 1: Measure the current pencil exactly.** Diff each current image against a pencil-free reference: saturated yellow/red/black pixels inside the left 40% (landscape) or centre (portrait). Print the bounding boxes, and use them as `PENCIL_BOX` below.

```python
from PIL import Image
for f in ['public/assets/ui/menu-background.webp', 'public/assets/ui/menu-background-portrait.webp']:
    im = Image.open(f).convert('RGB'); W, H = im.size
    xs, ys = [], []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = im.getpixel((x, y))
            if (r > 200 and g > 160 and b < 90) or (r > 190 and g < 90 and b < 110):  # pencil yellow / shoe red
                xs.append(x); ys.append(y)
    print(f, (min(xs), min(ys), max(xs), max(ys)))
```

- [ ] **Step 2: Write the composer.** It layers the art back to front at each output size:
  1. tiled `ui/paper-bg.webp` scaled to the image height (the in-game notebook paper);
  2. the four clouds from `background/cloud-{a,b,c,d}.webp` at the in-game fractions from `PaperScenery.ts` (`CLOUDS`), skipping any cloud whose box overlaps the title zone (top-centre third on landscape, top quarter on portrait);
  3. a ground row of `paper/tiles/ground-left`, `ground-center-{1,2,3}` (cycled), `ground-right`, scaled so the row's top edge sits at the measured ground line (two rows on portrait);
  4. `markers/spawn.webp` standing on the ground, right edge 20 px left of the pencil box;
  5. `markers/finish.webp` standing on the ground at the far right (landscape: right edge at W−60; portrait: omitted);
  6. the pencil: frame 1 of `~/Desktop/Assets/pencil sprites/idle.png` (crop its alpha bounding box within x 0–240), scaled to the measured box height and placed at the measured box.
  Then save lossy WebP q88 / alpha 90.

```python
# tools/compose-menu-art.py — rebuilds both menu backgrounds from game art.
# usage: python3 tools/compose-menu-art.py
import subprocess, tempfile
from pathlib import Path
from PIL import Image

A = Path('public/assets')
PENCIL_SRC = Path.home() / 'Desktop/Assets/pencil sprites/idle.png'
CLOUDS = [('cloud-a', 0.14, 0.13, 190), ('cloud-d', 0.42, 0.24, 130), ('cloud-b', 0.68, 0.11, 200), ('cloud-c', 0.9, 0.28, 150)]
LAYOUTS = {
    'menu-background': dict(size=(1672, 941), pencil=(280, 180, 575, 825), ground_y=775, rows=1,
                            title=(560, 0, 1112, 330), sharpener=True, cloud_scale=1.74),
    'menu-background-portrait': dict(size=(900, 1614), pencil=(295, 660, 605, 1330), ground_y=1285, rows=2,
                                     title=(0, 0, 900, 400), sharpener=False, cloud_scale=0.94),
}

def load(rel): return Image.open(A / rel).convert('RGBA')

def fit_h(im, h): return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

def overlaps(a, b): return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

def compose(name, size, pencil, ground_y, rows, title, sharpener, cloud_scale):
    W, H = size
    out = Image.new('RGBA', size)
    paper = fit_h(load('ui/paper-bg.webp'), H)
    for x in range(0, W, paper.width): out.alpha_composite(paper, (x, 0))
    for key, fx, fy, width in CLOUDS:
        cloud = load(f'background/{key}.webp')
        cloud = cloud.resize((round(width * cloud_scale), round(cloud.height * width * cloud_scale / cloud.width)), Image.LANCZOS)
        box = (round(fx * W - cloud.width / 2), round(fy * H - cloud.height / 2))
        if not overlaps((*box, box[0] + cloud.width, box[1] + cloud.height), title):
            out.alpha_composite(cloud, box)
    tile_h = round((H - ground_y) / rows) if rows > 1 else round((H - ground_y) * 1.0)
    tiles = [fit_h(load(f'paper/tiles/ground-{s}.webp'), tile_h) for s in ('left', 'center-1', 'center-2', 'center-3', 'right')]
    for r in range(rows):
        x, i, y = 0, 0, ground_y + r * tile_h
        while x < W:
            t = tiles[0] if x == 0 else tiles[1 + i % 3]
            out.alpha_composite(t, (x, y)); x += t.width; i += 1
    case = fit_h(load('markers/spawn.webp'), round((pencil[3] - pencil[1]) * 0.28))
    out.alpha_composite(case, (pencil[0] - 20 - case.width, ground_y - case.height + 6))
    if sharpener:
        sharp = fit_h(load('markers/finish.webp'), round((pencil[3] - pencil[1]) * 0.42))
        out.alpha_composite(sharp, (W - 60 - sharp.width, ground_y - sharp.height + 6))
    src = Image.open(PENCIL_SRC).convert('RGBA')
    frame = src.crop((0, 0, 240, src.height))
    frame = frame.crop(frame.getchannel('A').getbbox())
    hero = frame.resize((pencil[2] - pencil[0], pencil[3] - pencil[1]), Image.LANCZOS)
    out.alpha_composite(hero, (pencil[0], pencil[1]))
    with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
        out.convert('RGB').save(tmp.name)
        subprocess.run(['cwebp', '-quiet', '-q', '88', tmp.name, '-o', str(A / f'ui/{name}.webp')], check=True)
    print('wrote', name)

for name, layout in LAYOUTS.items(): compose(name, **layout)
```

Replace the `pencil` and `ground_y` values with Step 1's measurements before running. `hero` is resized to the measured box; if the source aspect differs by more than 3%, fit by height and centre horizontally instead of stretching.

- [ ] **Step 3: Run it** (`python3 tools/compose-menu-art.py`), then re-run Step 1's measurement on the new files. Expected: pencil boxes within ±6 px of the old ones. That's the check that the CSS layout (Play group beside/below him, never over him) still holds.
- [ ] **Step 4: Build** (`npm run build`) **and hand to the user** to look at the feed card and the expanded menu in both orientations. Iterate on their feedback (element sizes, which clouds, whether the sharpener/case belong).
- [ ] **Step 5: Commit** the script and both webps: "Menu art rebuilt from the in-game sprites (both menus)".

---

### Task 5: Finish = pencil into the sharpener

**Files:**
- Create: `public/assets/player/player-dive.webp` (baked by Step 3)
- Modify: `src/client/game/systems/Juice.ts` (new `playSharpenerDive`, `stopSharpenerDive`; `playFinishGateAnimation` reused for the grind pulses)
- Modify: `src/client/game/entities/Player.ts` (`freeze()` stops playing the dance, adds `hide()`; remove `player-dance-*` from `PLAYER_TEXTURE_KEYS` and the dance anim)
- Modify: `src/client/game/scenes/GameScene.ts` (`onFinishReached`, restart/cleanup path)
- Modify: `src/client/game/scenes/Preloader.ts` (load `player-dive`)

**Interfaces:**
- Produces: `playSharpenerDive(scene, from: { x: number; y: number; textureKey: string }, sharpener: Phaser.GameObjects.Sprite, onInside: () => void): SharpenerDive` and `stopSharpenerDive(dive: SharpenerDive): void`, where `type SharpenerDive = { destroy: () => void }`.
- Consumes: `FINISH_MOUTH_OFFSET_X`, `FINISH_MOUTH_HEIGHT` (already in `Juice.ts`), `burstParticles`, `playPixelFx('finish-blast')`.

Sequence, all on a stand-in image (the real player is hidden; nothing touches the physics sprite or the finish sensor's position):

1. **Hop (0–280 ms):** an upright stand-in (current pose texture) arcs from the player's position to just left of the mouth: `x = mouthX − 1.1·PLAYER_SIZE`, `y = mouthY + PLAYER_SIZE/2` (bottom-anchored).
2. **Line up (instant):** switch to `player-dive` (horizontal, tip right), origin (0, 0.5), tip at `mouthX + DIVE_TIP_INSET`.
3. **Slide in (280–1000 ms, `Sine.easeIn`):** move right by the pencil's full length while cropping off everything past `mouthX`, so he disappears into the hole. Wood/graphite shavings (`0xf2c078`, `0x3a3a3a`) burst from the slot every 120 ms, and the sharpener pulses (scale only, `playFinishGateAnimation`).
4. **Grind (1000–1400 ms):** two more shaving bursts and a small camera shake.
5. **Done (1400 ms):** `finish-blast` from the mouth plus the existing fireworks, then `onInside()`.

- [ ] **Step 1: Check the crop API in Phaser 4.2.1.** Use context7 (`/phaserjs/phaser`, query "Image setCrop Phaser 4") to confirm `Image#setCrop(x, y, width, height)` exists and takes frame pixels. If it doesn't, use this fallback in Step 4 instead of the crop: set the dive image's origin to (1, 0.5), place its right edge (the tip) at `mouthX`, and tween `displayWidth` from `PLAYER_SIZE` down to 0, so the pencil shortens into the hole rather than sliding. Note in a code comment which one was used.

- [ ] **Step 2: Write the failing scenario.** It finishes a level, steps 2 s, and checks the dive ran, ended inside, left no stand-ins, hid the player, and a restart mid-dive cleans up. Then it repeats via dev warp (`onFinishReached(true)`), which fires from wherever the player is.

```js
// <scratchpad>/sharpener.mjs
export default async function ({ page, errors, harness }) {
  const level = [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 700, y: 480 }, ...harness.groundTiles(20)];
  const count = () => page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene')
    .children.list.filter((o) => o.texture?.key === 'player-dive').length);
  for (const warp of [false, true]) {
    await harness.startLevel(page, level);
    await harness.pause(page);
    await page.evaluate((warp) => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached(warp), warp);
    await harness.step(page, 30);
    if ((await count()) !== 1) throw new Error('no dive stand-in mid-animation');
    const hidden = await page.evaluate(() => !window.__PHASER_GAME__.scene.getScene('GameScene').player.sprite.visible);
    if (!hidden) throw new Error('real player still visible during dive');
    await harness.step(page, 90);
    const inside = await page.evaluate(() => window.__SKETCHY_DIVE_INSIDE__ === true);
    if (!inside) throw new Error('dive never reported inside');
    await harness.resume(page);
  }
  // Restart mid-dive: no stand-in survives and the player is back.
  await harness.startLevel(page, level);
  await harness.pause(page);
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').onFinishReached());
  await harness.step(page, 20);
  await page.evaluate(() => window.__PHASER_GAME__.scene.getScene('GameScene').restartRun());
  await harness.step(page, 5);
  if ((await count()) !== 0) throw new Error('dive stand-in leaked past restart');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
```

Run it: `npm run playtest -- <scratchpad>/sharpener.mjs --rebuild`. **Expected: fail** with `no dive stand-in mid-animation`.

- [ ] **Step 3: Bake the dive pose** (decision D1). This is a lossless 90° rotation of existing art, not a redraw:

```bash
python3 -c "
from PIL import Image
im = Image.open('public/assets/player/player-idle.webp').convert('RGBA')
im.rotate(90, expand=True).save('/tmp/dive.png')"
cwebp -quiet -q 88 -alpha_q 90 /tmp/dive.png -o public/assets/player/player-dive.webp
```

(`rotate(90)` is counter-clockwise, so the tip at the bottom ends up pointing right.) Load it in `Preloader.ts` next to the player poses: `this.load.image('player-dive', 'player/player-dive.webp');`.

- [ ] **Step 4: Implement the dive** in `Juice.ts`:

```ts
const DIVE_HOP_MS = 280;
const DIVE_SLIDE_MS = 720;
const DIVE_GRIND_MS = 400;
// The dive texture's tip sits this far in from its right edge (frame
// padding); tuned by eye so the point, not the padding, meets the hole.
const DIVE_TIP_INSET_PX = 6;
const SHAVING_WOOD = 0xf2c078;
const SHAVING_GRAPHITE = 0x3a3a3a;

export type SharpenerDive = { destroy: () => void };

// Clear-screen finish: the pencil hops to the sharpener's mouth, turns
// tip-first and slides in, disappearing at the hole while shavings fly
// and the sharpener grinds. Works on a stand-in image; the caller has
// already hidden the real (physics) player. `onInside` fires once he's
// fully in. destroy() stops everything, for a restart mid-dive.
export function playSharpenerDive(
  scene: Phaser.Scene,
  from: { x: number; y: number; textureKey: string },
  sharpener: Phaser.GameObjects.Sprite,
  onInside: () => void
): SharpenerDive {
  const mouthX = sharpener.x - sharpener.displayWidth * FINISH_MOUTH_OFFSET_X;
  const mouthY = sharpener.y - sharpener.displayHeight * FINISH_MOUTH_HEIGHT;
  const depth = sharpener.depth + 0.02;
  const pencil = scene.add.image(from.x, from.y, from.textureKey).setOrigin(0.5, 1).setDepth(depth);
  pencil.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
  const timers: Phaser.Time.TimerEvent[] = [];
  let tween: Phaser.Tweens.Tween | Phaser.Tweens.TweenChain | undefined;

  const shavings = () => {
    burstParticles(scene, mouthX, mouthY, SHAVING_WOOD, 8);
    burstParticles(scene, mouthX, mouthY, SHAVING_GRAPHITE, 4);
  };

  const slideIn = () => {
    pencil.setTexture('player-dive').setOrigin(0, 0.5);
    pencil.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    const scale = pencil.scaleX;
    const frameW = pencil.frame.width;
    const startLeft = mouthX + DIVE_TIP_INSET_PX - PLAYER_SIZE;
    pencil.setPosition(startLeft, mouthY);
    const slide = { d: 0 };
    playFinishGateAnimation(scene, sharpener);
    timers.push(scene.time.addEvent({ delay: 120, repeat: 5, callback: shavings }));
    tween = scene.tweens.add({
      targets: slide,
      d: PLAYER_SIZE,
      duration: DIVE_SLIDE_MS,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const left = startLeft + slide.d;
        pencil.setX(left);
        // Only the part still left of the hole is drawn.
        pencil.setCrop(0, 0, Phaser.Math.Clamp((mouthX - left) / scale, 0, frameW), pencil.frame.height);
      },
      onComplete: () => {
        pencil.setVisible(false);
        scene.cameras.main.shake(DIVE_GRIND_MS, 0.003);
        timers.push(scene.time.addEvent({ delay: 180, repeat: 1, callback: shavings }));
        timers.push(scene.time.delayedCall(DIVE_GRIND_MS, () => {
          playPixelFx(scene, 'finish-blast', mouthX, mouthY, { scale: FINISH_BLAST_SCALE, depth });
          Reflect.set(window, '__SKETCHY_DIVE_INSIDE__', true);
          onInside();
        }));
      },
    });
  };

  Reflect.set(window, '__SKETCHY_DIVE_INSIDE__', false);
  tween = scene.tweens.chain({
    targets: pencil,
    tweens: [
      { x: mouthX - PLAYER_SIZE * 1.1, duration: DIVE_HOP_MS, ease: 'Linear' },
    ],
    onComplete: slideIn,
  });
  // The hop's arc: up then down onto the mouth line, alongside the x move.
  scene.tweens.chain({
    targets: pencil,
    tweens: [
      { y: Math.min(from.y, mouthY + PLAYER_SIZE / 2) - 60, duration: DIVE_HOP_MS / 2, ease: 'Quad.easeOut' },
      { y: mouthY + PLAYER_SIZE / 2, duration: DIVE_HOP_MS / 2, ease: 'Quad.easeIn' },
    ],
  });

  return {
    destroy: () => {
      tween?.stop();
      scene.tweens.killTweensOf(pencil);
      for (const timer of timers) timer.remove();
      stopFinishGateAnimation(scene, sharpener);
      pencil.destroy();
    },
  };
}
```

(Import `PLAYER_SIZE` from `../constants` if `Juice.ts` doesn't already.)

- [ ] **Step 5: Wire it into the finish.** In `Player.ts`, `freeze()` stops playing the dance and the player hides:

```ts
  // Called once, when the finish line is reached (GameScene.onFinishReached).
  // The finish animation (Juice.playSharpenerDive) runs on a stand-in, so
  // the real pencil just stops and hides; reset() shows it again.
  freeze(): void {
    this.alive = false;
    this.clearEffectSprites();
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.sprite.setScale(PLAYER_BASE_SCALE, PLAYER_BASE_SCALE);
    this.sprite.anims.stop();
    this.sprite.setVisible(false);
  }
```

Remove `player-dance-1…9` from `PLAYER_TEXTURE_KEYS`, and remove the dance animation and its `ANIM_SCALE_TABLES` entry (decision D3). Keep `DANCE_FRAME_MS` in `constants.ts`, because `playFinishGateAnimation` still times its pulses with it.

In `GameScene`, add `private sharpenerDive: SharpenerDive | undefined;`. In `onFinishReached`, capture the pose before freezing and replace the `playFinishGateAnimation` call:

```ts
    const pose = { x: this.player.sprite.x, y: this.player.sprite.y, textureKey: this.player.sprite.texture.key };
    this.player.freeze();
    ...
    if (this.finishSprite) {
      const finish = this.finishSprite;
      this.sharpenerDive = playSharpenerDive(this, pose, finish, () => this.playFinishFireworks(finish));
    }
```

Wherever the scene already calls `stopFinishGateAnimation` on restart/cleanup, also call `this.sharpenerDive?.destroy(); this.sharpenerDive = undefined;`.

- [ ] **Step 6: Run the scenario. Expected: `ok`.** Also run `node tools/check-client-build.mjs` after `npm run build` (the dance frames leaving the preload list shrinks the load; the budgets must still pass).
- [ ] **Step 7: User watches it** on desktop and phone. Tune `DIVE_TIP_INSET_PX`, the hop height and the timings, and flag it if the camera framing (`frameFinish`) cuts the sharpener off.
- [ ] **Step 8: Commit** `player-dive.webp`, `Juice.ts`, `Player.ts`, `GameScene.ts`, `Preloader.ts`: "Clearing a level feeds the pencil into the sharpener".

---

### Task 6: Switch off the in-run progress bar (kept in code)

**Files:**
- Modify: `src/client/ui/RunHud.ts`
- Modify: `src/client/game.html` (the `#run-hud-progress-row` element gets `hidden`)

**Interfaces:** `RunHud.setProgress`/`setBest` keep their signatures and still get called. `GameScene`'s best-progress tracking is untouched, because `STRUGGLE_MAX_PROGRESS` (the First Blood offer) reads it.

- [ ] **Step 1: Write the failing scenario:** start a level, run 2 s, and assert `#run-hud-progress-row` is not visible while `#run-hud-attempt` is.

```js
export default async function ({ page, errors, harness }) {
  await harness.startLevel(page, [{ type: 'spawn', x: 90, y: 480 }, { type: 'finish', x: 3000, y: 480 }, ...harness.groundTiles(60)]);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  if (await page.isVisible('#run-hud-progress-row')) throw new Error('progress bar visible');
  if (!(await page.isVisible('#run-hud-attempt'))) throw new Error('attempt counter hidden');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'ok';
}
```

Expected now: fail with `progress bar visible`.

- [ ] **Step 2: Turn it off with a note.** In `RunHud.ts`, above the class:

```ts
// The level-progress bar is switched OFF on purpose (user request,
// 2026-09-29: "I don't want it in the game"). Its markup, CSS and the
// setProgress()/setBest() code below are kept so it can come back by
// flipping this flag. Best-progress is still saved (GameScene uses it for
// the First Blood offer); it just isn't drawn.
const SHOW_PROGRESS_BAR = false;
```

In the class, add `private readonly progressRowEl = requireElement('run-hud-progress-row');`. In `show()`, add `this.progressRowEl.classList.toggle('hidden', !SHOW_PROGRESS_BAR);`. Make `setProgress` and `setBest` start with `if (!SHOW_PROGRESS_BAR) return;` so nothing touches the DOM every frame. In `game.html`, add `class="hidden"` to `#run-hud-progress-row` with an HTML comment pointing at `SHOW_PROGRESS_BAR`. Update the class's header comment ("an attempt counter (top-left) and a thin level-progress bar…") to say the bar is currently off.

- [ ] **Step 3: Run the scenario. Expected: `ok`.** Then `npm run type-check && npm run lint`.
- [ ] **Step 4: Commit** `RunHud.ts` and `game.html`: "Switch off the in-run progress bar (kept behind SHOW_PROGRESS_BAR)".

---

### Task 7: Wrap-up

- [ ] `npm run check:production`. Expected: all green, budgets pass.
- [ ] Delete the scratchpad scenarios (they aren't committed; `tools/playtest` stays the harness).
- [ ] Update `docs/production-performance.md`: the new vfx sheets under "Implemented optimizations" (lossless pixel sheets), the dance frames no longer preloaded, and `tools/pack-fx.py` / `tools/compose-menu-art.py` as the way to add effects and rebuild menu art.
- [ ] Commit the doc.

## Order and dependencies

Task 1 comes first (Tasks 2 and 3 need its sheets). Task 6 is independent and tiny, so it can go any time. Tasks 4 and 5 are independent of each other and of 2 and 3. Suggested order: 6 → 1 → 2 → 3 → 5 → 4, with the art-heavy item (4) last because it needs the most back-and-forth with the user.
