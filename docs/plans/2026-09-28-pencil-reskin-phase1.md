# Pencil Reskin — Phase 1 (test slice)

**Goal:** Put the new pencil character and a sketchbook world into the game on a test branch, so the owner can judge the new look from screenshots before any full reskin.

**Scope:** visuals only. No gameplay, physics, hitbox, input timing or level-layout changes (project rule: visual polish never touches those). The owner will decide on the hitbox separately. See "Not in this phase".

**Branch:** `pencil-test` (already exists; one commit `a4a7d60` swapped the run cycle using `~/Desktop/Assets/pencil.png`). Do all work there and never merge to `main`. Check it out with `git checkout pencil-test` and make sure the tree is clean first.

**Read first:** `AGENTS.md` (no `as` casts, type aliases, named exports), and memory notes `asset_reskin_workflow.md` (asset slicing/encoding rules) and `feedback_polish_means_visual.md`.

---

## Inputs (all in `~/Desktop/Assets/`)

| What | Where | Notes |
|---|---|---|
| Pencil running sheet | `pencil.png` (2172×724, 6 frames, already sliced once) and/or a newer running sheet | The owner added **running, idle and jumping** sheets on 2026-09-28. Their filenames are unknown: run `ls -t ~/Desktop/Assets` and open each new PNG to identify it. |
| Pencil idle sheet | new file, see above | |
| Pencil jumping sheet | new file, see above | Map frames to rise / tuck / fall by eye. |
| Scribble world art | `~/Desktop/Assets/kenney_scribble-platformer/` (Kenney "Scribble Platformer", CC0) | `Preview.png` shows every piece: white doodle shapes with black outlines. Use the individual PNGs (look for a `PNG/` or `Tiles/` folder); pick pieces by comparing against `Preview.png`. |

---

## Task 1: Player sprites

The player is drawn from individual textures in `public/assets/player/`: `player-idle`, `player-run-1..6`, `player-jump-rise`, `player-jump-tuck`, `player-jump-fall`, `player-dance-1..12` (see `PLAYER_TEXTURE_KEYS` in `src/client/game/entities/Player.ts`). Every file is a **362×362** RGBA canvas with the feet on the bottom row. The hitbox math (`PLAYER_FRAME_SIZE = 362`) depends on that, so **keep that canvas exactly**.

1. For each sheet, split the frames by connected component (alpha > 20). Attach small stray components to the nearest large figure. Don't split by fixed columns: feet overlap neighbouring cells and leave slivers.
2. Scale every frame of **all** sheets by the same factor so the tallest figure is **324 px**. Paste each onto a 362×362 canvas, bottom-aligned, with the pencil's **eraser/head centroid** (the top 15% of the figure) at x = 181, so frames don't jitter horizontally.
3. Save as lossy WebP (`quality=88, alpha_quality=90`) over:
   - `player-run-1..6` from the running sheet (6 frames; if it has a different count, use 6 evenly spaced frames);
   - `player-idle` from the idle sheet (its first/neutral frame);
   - `player-jump-rise`, `player-jump-tuck`, `player-jump-fall` from the jumping sheet (up / top / down);
   - `player-dance-1..12`: cycle the idle frames (there's no dance art yet).
4. Paste all frames side by side on white and **look at the strip**: no slivers of neighbouring frames, same size, no jitter.

The slicing script used for commit `a4a7d60` (run cycle only) was:

```python
import numpy as np
from PIL import Image
from scipy import ndimage
a=np.array(Image.open(SRC).convert('RGBA')); mask=a[:,:,3]>20
lab,n=ndimage.label(mask); sizes=ndimage.sum(mask,lab,range(1,n+1))
big=sorted([i+1 for i,s in enumerate(sizes) if s>20000], key=lambda i: ndimage.center_of_mass(mask,lab,i)[1])
bx=[ndimage.center_of_mass(mask,lab,i)[1] for i in big]; groups={i:[i] for i in big}
for i in range(1,n+1):
    if i in groups: continue
    cx=ndimage.center_of_mass(mask,lab,i)[1]; groups[big[int(np.argmin([abs(cx-b) for b in bx]))]].append(i)
# per group: soft=dilate(isin(lab,group),2)&(alpha>0); crop to bbox; head anchor = mean x of top 15% rows
# scale = 324 / max_height_across_ALL_sheets; paste on 362x362 bottom-aligned, head anchor at x=181
```

Commit: "Pencil test: idle, run and jump poses from the new sheets".

## Task 2: Paper background, scribble ground and platforms

1. **Lined paper background.** Generate `public/assets/ui/paper-bg.webp`, 512×540 and tileable horizontally:
   - off-white `#fbf8ef` fill;
   - pale blue (`#a9c7e8`) horizontal rules every 34 px starting at y = 60;
   - **no** red margin line, since the background tiles across the whole level.

   The level background is the `'level-background'` texture, tiled in `GameScene.startRun` (`tileSprite(..., 'level-background')`). Find where `Preloader.ts` loads `'level-background'` and point it at the new file. Also remove or neutralise any dark tint/overlay drawn over the background in `startRun` (there's a comment "The background art is busy/saturated enough to compete with hazard…"), so the paper reads as paper. Set `cameras.main.setBackgroundColor` to `#fbf8ef` in GameScene.
2. **Ground and platforms.** Pick a plain scribble block (top-left of `Preview.png`) for ground and a thinner or plain block for platforms. Find how ground/platform textures are chosen in `src/client/game/objects/ObjectRegistry.ts` and the tile loads in `Preloader.ts`, and swap the texture files. Keep the **display sizes** the code already sets (for example `PLATFORM_DISPLAY_HEIGHT_PX`, one `GRID_CELL_SIZE` = 60 px wide), so collision is unchanged. Keep scribble tiles **lossless** (PNG or lossless WebP).
3. Spawn and finish: the scribble **door** for the spawn marker and the scribble **flag** for the finish. Swap texture files only; keep the existing display heights (`SPAWN_TOMBSTONE_HEIGHT_PX`, `FINISH_DISPLAY_HEIGHT_PX`) and the finish trigger size.
4. Where the slime/Halloween pixel effects make no sense on paper (spawn lightning, arcane crackle on the gate), leave them for Phase 2. Only remove something here if it visibly breaks the screenshot.

Commit: "Pencil test: lined paper background and scribble ground, platforms, door and flag".

## Task 3: Traps + optional red tint

1. **Saw → scribble gear** (the cog in `Preview.png`, row 1). **Candle → scribble spikes** (the pair of triangles, row 3). Swap only the texture files/keys these types use in `ObjectRegistry.ts` / `Preloader.ts` (the candle is an animated sheet; a static image is fine for the test, but make sure the anim code doesn't break when the texture has one frame, e.g. by keeping a single-frame anim). Keep the display sizes, so hitboxes are unchanged. Leave bat, ghost, moving saw, falling block and power-ups on their old art.
2. **Red tint.** Scribble art is white with black outlines. Phaser's default tint multiplies, so `sprite.setTint(0xe53935)` turns the white fill red and keeps the black outline black. Add one constant, `HAZARD_TINT: number | null = 0xe53935`, in `src/client/game/constants.ts`, and apply it to every hazard sprite where hazards are created (LevelLoader/ObjectRegistry), but only when non-null. This is so the owner can compare: take screenshots with the tint on and off (null).

Commit: "Pencil test: scribble gear and spikes, optional red tint for traps".

## Task 4: Screenshots for the owner

1. Run `npm run type-check`, `npm run lint`, `npm run build`. Don't run the full browser suite (the owner asked to keep testing light).
2. Using the harness in memory `playtest_harness_notes.md` (static server on `dist/client`, Playwright from the repo's `node_modules`, `window.__PHASER_GAME__`; scratch files **outside** the repo), open `game.html?level=meat-grinder` with `localStorage['cursed:tutorial-done']='1'`. Route `/api/levels/meat-grinder` to the seed level from `src/server/core/seedLevels.ts` and every other `/api/*` to 404. Click `#game-menu-play` and press Space to start.
3. Take screenshots at **390×844** and **844×390**: one mid-run, one mid-jump, one next to a trap. Take them with `HAZARD_TINT` on, then rebuild with it off and take one comparison shot.
4. **Look at every screenshot yourself** before handing off. Check that the pencil is fully visible, the ground sits flush under its feet, traps are clearly distinguishable from ground, and nothing is cut off.
5. Report to the owner: the screenshot paths, what changed, what still has old art (bat, ghost, power-ups, VFX, UI colours), and a clear question: tint on or off?

---

## Not in this phase (Phase 2, only if the owner likes it)

- Stand-ins for the bat, ghost, moving saw, falling block and power-ups.
- Death animations and VFX restyled from pixel explosions to scribble/crumple.
- UI palette and fonts, feed card and menu art, tutorial logo, death-skull markers → pencil ✗.
- Music and SFX.
- Name and branding.

**Owner decisions still open:**
- **The hitbox.** The pencil is thinner than the old robot, but `HITBOX_WIDTH = 0.7` in `Player.ts` is sized for the robot. Do **not** change it without the owner's go-ahead: it changes every level's difficulty.
- Keep the name "CURSED" or rename.
