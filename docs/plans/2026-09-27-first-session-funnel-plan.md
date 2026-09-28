# First-Session Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry a brand-new player from the feed card to their first curse, and give them a reason to come back once other players hit it.

**Architecture:** Five beats, each a small, separate change on top of what exists. (1) The feed card gets a bottom strip holding the tagline and a silhouette of the course, built from a server-side summary of the level. (2) A built-in, uncurseable starter level follows the tutorial on the hub post; level posts keep their destination and offer the starter only when a player is struggling. (3) The death toast already names the trap's owner, so nothing new is needed there. (4) After a clear, "Leave Your Curse" sits next to "Next Level", and a player's first curse opens a guided mode with three picks and three suggested spots. (5) New Redis counters track how many unique players each curse caught and how many got past it; the STATS chip shows a "new" badge and the stats screen lists each curse.

**Tech Stack:** Devvit Web, Hono (server), Phaser 4 + DOM overlays (client), Devvit Redis, `node:test` unit tests (`npm run test:unit`), Playwright browser suite (`npm run test:browser`, after `npm run build`).

**Spec:** the user's five-beat brief (quoted in full under "Source brief" at the end of this file), plus the two decisions they made on 2026-09-27: the tagline and preview go in a header/bottom strip, never over the art, and the starter is built in and can't be cursed.

## Global Constraints

- Read `AGENTS.md`. Use type aliases, not interfaces; named exports; **never** `as` casts (write `is*` runtime guards like the existing `src/shared/*Api.ts` files do).
- **Feed card:** no text or UI over the artwork (`.scene`). New feed-card content goes in the header bar or a new strip outside `.scene`. Screenshot the splash at 700px and 360px wide after any change.
- **Curses can go anywhere.** Suggested spots are hints only. Never block placement, and never add spawn-distance, occupied-cell or finish-blocking rules for curses.
- **No private messages** to players. All feedback appears inside the game.
- **No time-based competition.** Don't add clear times, ranks or PB/WR to any new UI.
- **Splash must stay fast.** `splash.ts` must not import Phaser or anything heavy. The production size check (`tools/check-client-build.mjs`) must keep passing.
- **Built-in author:** anything built in uses `SEED_AUTHOR` (from `src/shared/constants.ts`), so deaths name no player and stats skip it.
- **The starter level id is `first-blood`** (title "First Blood").
- **Tagline copy, exactly:** `Beat the level. Add your curse. Let Reddit deal with it.`
- **Feedback copy, exactly:** `Your {Trap} caught {N} player(s). {M} made it through.` Use `labelFor(type)` from `src/shared/objectLabels.ts`, and "player" when N is 1.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Reporting your own trap.** Dying to or passing your own curse must not count as "caught" or "made it through". Pinned in Task 7's tests.
2. **The same player dying repeatedly.** 30 deaths from one player on one candle is 1 player caught, not 30. Pinned in Task 7 (unique-player hashes).
3. **A level with no room for suggestions** (short, or packed with hazards). Guided mode must still work with zero to three suggestions, and nothing may crash. Pinned in Task 8 (`suggestCurseCells` edge tests).
4. **The starter level through every entry point.** It must never show the curse button, never be proposed for a curse on the server, and never be picked as Level of the Day. Pinned in Task 4.
5. **Very wide or very short levels in the splash preview.** The silhouette must fit the strip's width without horizontal scroll, and markers must stay visible at 360px. Pinned in Task 3 (renderer tests plus screenshots).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/coursePreview.ts` | new | `buildCoursePreview(level)`: a level summarised to ground spans, platforms, hazards, spawn and finish. Guard included. |
| `src/shared/hazards.ts` | new | `HAZARD_TYPES`: the single list of object types that count as traps (used by the preview, suggestions and pass tracking). |
| `src/server/routes/levels.ts` | modify | `GET /api/levels/:levelId/preview` |
| `src/client/ui/coursePreviewSvg.ts` | new | Pure `renderCoursePreviewSvg(preview, widthPx, heightPx): string` |
| `src/client/splash.html` / `.css` / `.ts` | modify | Bottom strip: tagline + preview |
| `src/shared/constants.ts` | modify | `STARTER_LEVEL_ID`, `CURSE_LOCKED_LEVEL_IDS`, `STRUGGLE_DEATHS`, `STRUGGLE_MAX_PROGRESS` |
| `src/server/core/seedLevels.ts` | modify | Seeds the First Blood level |
| `src/server/routes/curse.ts` | modify | Rejects curse proposals on locked levels; records the curse in the player's list on publish |
| `src/server/services/DailyService.ts` | modify | Never features a locked level |
| `src/client/game/scenes/GameScene.ts` | modify | Starter routing, `returnTo`, struggle offer, curse button hidden on locked levels |
| `src/client/ui/StarterOffer.ts` | new | Non-blocking "Too tough? Warm up →" button |
| `src/client/game.html` / `game.css` | modify | Markup and styles for the offer, result row, guided curse and curse list |
| `src/shared/curseSuggestions.ts` | new | Pure `suggestCurseCells(objects, count)` |
| `src/client/game/scenes/CurseScene.ts`, `src/client/ui/CurseToolbar.ts` | modify | Guided first-curse mode |
| `src/server/core/redisKeys.ts` | modify | `userCursesKey`, `trapCaughtByKey`, `trapPassedByKey`, `userCursesSeenKey` |
| `src/shared/trapStats.ts` | new | Pure `passedHazardIds(objects, reachedX, username)` |
| `src/server/services/TrapStatsService.ts` | new | Records catches, passes and placed curses; reads a player's curses |
| `src/shared/myCursesApi.ts` | new | `MyCurse`, `MyCursesResponse` + guards |
| `src/server/routes/myCurses.ts` | new | `GET /api/me/curses`, `POST /api/me/curses/seen` |
| `src/server/routes/runs.ts`, `deaths.ts` | modify | Call the TrapStatsService recorders |
| `src/client/ui/GameMenu.ts`, `StatsOverlay.ts` | modify | "New" badge on the STATS chip; "Your curses" list |
| `src/server/tests/funnel.test.ts` | new | Server and shared unit tests for this plan |
| `tools/game-regressions.mjs` | modify | Browser tests for routing, the starter bot run and the guided curse |

---

### Task 1: Course preview data (shared + server route)

**Files:**
- Create: `src/shared/hazards.ts`, `src/shared/coursePreview.ts`
- Modify: `src/server/routes/levels.ts`
- Test: `src/server/tests/funnel.test.ts` (new file; later tasks add to it)

**Interfaces:**
- Produces: `HAZARD_TYPES: ReadonlySet<ObjectType>`; `type CoursePreview = { width: number; ground: [number, number][]; platforms: { x: number; y: number }[]; hazards: { x: number; y: number; type: ObjectType }[]; spawnX: number; finishX: number }`; `buildCoursePreview(level: LevelVersion): CoursePreview`; `isCoursePreview(value: unknown): value is CoursePreview`; route `GET /api/levels/:levelId/preview` returning a `CoursePreview`, or a 404.

- [ ] **Step 1: Write the failing tests** in `src/server/tests/funnel.test.ts`

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_CELL_SIZE, GROUND_TOP_Y, SEED_AUTHOR } from '../../shared/constants';
import type { LevelObject, LevelVersion, ObjectType } from '../../shared/types';
import { buildCoursePreview, isCoursePreview } from '../../shared/coursePreview';

export function obj(id: string, type: ObjectType, x: number, y = GROUND_TOP_Y, addedBy = SEED_AUTHOR): LevelObject {
  return { id, type, x, y, properties: {}, addedBy, addedInVersion: 1 };
}
export function groundTiles(fromX: number, toX: number): LevelObject[] {
  const tiles: LevelObject[] = [];
  for (let x = fromX; x < toX; x += GRID_CELL_SIZE) tiles.push(obj(`g${x}`, 'ground', x + GRID_CELL_SIZE / 2));
  return tiles;
}
export function levelOf(objects: LevelObject[]): LevelVersion {
  return { levelId: 'l', version: 1, parentVersion: null, objects, contributorUsername: SEED_AUTHOR, verificationTimeMs: 1, createdAt: 0 };
}

await test('course preview merges ground into spans and keeps gaps', () => {
  const preview = buildCoursePreview(levelOf([
    ...groundTiles(0, 600), ...groundTiles(720, 1200),
    obj('s', 'spawn', 80), obj('f', 'finish', 1140), obj('c', 'candle', 400),
    obj('p', 'platform', 900, GROUND_TOP_Y - 120), obj('sh', 'shield', 300),
  ]));
  assert.deepEqual(preview.ground, [[0, 600], [720, 1200]]);
  assert.deepEqual(preview.hazards, [{ x: 400, y: GROUND_TOP_Y, type: 'candle' }]);
  assert.deepEqual(preview.platforms, [{ x: 900, y: GROUND_TOP_Y - 120 }]);
  assert.equal(preview.spawnX, 80);
  assert.equal(preview.finishX, 1140);
  assert.equal(preview.width, 1200);
  assert.ok(isCoursePreview(preview));
});

await test('course preview guard rejects malformed shapes', () => {
  assert.equal(isCoursePreview({}), false);
  assert.equal(isCoursePreview({ width: 1, ground: [[0]], platforms: [], hazards: [], spawnX: 0, finishX: 0 }), false);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm run test:unit`
Expected: FAIL, because `../../shared/coursePreview` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/shared/hazards.ts`:
```ts
import type { ObjectType } from './types';

// Object types that kill on contact — the "traps" a curse can add and the
// ones the course preview, curse suggestions and pass tracking care about.
export const HAZARD_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>([
  'candle', 'saw', 'movingSaw', 'bat', 'ghost', 'fallingBlock',
]);
```

`src/shared/coursePreview.ts`:
```ts
import { GRID_CELL_SIZE } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelVersion, ObjectType } from './types';

// A level boiled down to what the feed card's course silhouette draws —
// small enough for the splash to fetch on every impression.
export type CoursePreview = {
  width: number;
  ground: [number, number][];
  platforms: { x: number; y: number }[];
  hazards: { x: number; y: number; type: ObjectType }[];
  spawnX: number;
  finishX: number;
};

export function buildCoursePreview(level: LevelVersion): CoursePreview {
  const half = GRID_CELL_SIZE / 2;
  const tiles = level.objects
    .filter((o) => o.type === 'ground')
    .map((o) => [o.x - half, o.x + half] as const)
    .sort((a, b) => a[0] - b[0]);
  const ground: [number, number][] = [];
  for (const [from, to] of tiles) {
    const last = ground.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else ground.push([from, to]);
  }
  const spawnX = level.objects.find((o) => o.type === 'spawn')?.x ?? 0;
  const finishX = level.objects.find((o) => o.type === 'finish')?.x ?? 0;
  const rightmost = Math.max(finishX + half, ...level.objects.map((o) => o.x + half));
  return {
    width: rightmost,
    ground,
    platforms: level.objects
      .filter((o) => o.type === 'platform' || o.type === 'movingPlatform')
      .map((o) => ({ x: o.x, y: o.y })),
    hazards: level.objects
      .filter((o) => HAZARD_TYPES.has(o.type))
      .map((o) => ({ x: o.x, y: o.y, type: o.type })),
    spawnX,
    finishX,
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null && 'x' in v && isFiniteNumber(v.x) && 'y' in v && isFiniteNumber(v.y);

export function isCoursePreview(value: unknown): value is CoursePreview {
  return (
    typeof value === 'object' && value !== null &&
    'width' in value && isFiniteNumber(value.width) &&
    'ground' in value && Array.isArray(value.ground) &&
    value.ground.every((s: unknown) => Array.isArray(s) && s.length === 2 && s.every(isFiniteNumber)) &&
    'platforms' in value && Array.isArray(value.platforms) && value.platforms.every(isPoint) &&
    'hazards' in value && Array.isArray(value.hazards) &&
    value.hazards.every((h: unknown) => isPoint(h) && 'type' in h && typeof h.type === 'string') &&
    'spawnX' in value && isFiniteNumber(value.spawnX) &&
    'finishX' in value && isFiniteNumber(value.finishX)
  );
}
```
(`as const` on a tuple literal is fine. It's a literal assertion, not a type cast. If the linter objects, write `const span: [number, number] = [o.x - half, o.x + half]` inside a block body instead.)

Route in `src/server/routes/levels.ts`, registered **before** `levels.get('/:levelId', …)` so Hono matches it first:
```ts
levels.get('/:levelId/preview', async (c) => {
  const requestedId = c.req.param('levelId');
  const levelId = await resolveLevelId(requestedId);
  const level =
    (await getCurrentLevelVersion(levelId)) ??
    (levelId !== requestedId ? await getCurrentLevelVersion(DEFAULT_LEVEL_ID) : undefined);
  if (!level) return c.json<ErrorResponse>({ status: 'error', message: `Unknown level "${levelId}"` }, 404);
  return c.json<CoursePreview>(buildCoursePreview(level));
});
```

- [ ] **Step 4: Run the tests**. Run `npm run test:unit && npm run test:types && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/shared/hazards.ts src/shared/coursePreview.ts src/server/routes/levels.ts src/server/tests/funnel.test.ts && git commit` with the message "Add a course preview summary and route".

---

### Task 2: Course preview SVG renderer

**Files:**
- Create: `src/client/ui/coursePreviewSvg.ts`
- Test: add to `src/server/tests/funnel.test.ts`. The renderer is pure string output, so it runs under node.

**Interfaces:**
- Consumes: `CoursePreview` (Task 1).
- Produces: `renderCoursePreviewSvg(preview: CoursePreview, widthPx: number, heightPx: number): string`, a complete `<svg>…</svg>` string sized `widthPx`×`heightPx`, drawn in screen pixels.

- [ ] **Step 1: Write the failing tests**

```ts
import { renderCoursePreviewSvg } from '../../client/ui/coursePreviewSvg';

await test('preview svg fits the strip width for very wide and very short levels', () => {
  for (const width of [600, 5400]) {
    const preview = buildCoursePreview(levelOf([...groundTiles(0, width), obj('s', 'spawn', 80), obj('f', 'finish', width - 60), obj('c', 'saw', width / 2)]));
    const svg = renderCoursePreviewSvg(preview, 360, 30);
    assert.match(svg, /^<svg [^>]*width="360" height="30"/);
    for (const m of svg.matchAll(/(?:x|cx)="(-?[\d.]+)"/g)) {
      const x = Number(m[1]);
      assert.ok(x >= 0 && x <= 360, `x ${x} out of strip`);
    }
    assert.match(svg, /<circle [^>]*r="3.5"/, 'hazard markers keep a fixed on-screen size');
  }
});

await test('preview svg contains only numeric geometry (no injected text)', () => {
  const svg = renderCoursePreviewSvg({ width: 100, ground: [[0, 100]], platforms: [], hazards: [{ x: 50, y: 480, type: 'candle' }], spawnX: 0, finishX: 90 }, 200, 30);
  assert.equal(svg.includes('<text'), false);
});
```

- [ ] **Step 2: Run them to confirm they fail.** Run `npm run test:unit`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `src/client/ui/coursePreviewSvg.ts`

```ts
import { GROUND_TOP_Y } from '../../shared/constants';
import type { CoursePreview } from '../../shared/coursePreview';
import type { ObjectType } from '../../shared/types';

// The feed card's course silhouette. Scaled horizontally to the strip, but
// markers keep a fixed on-screen size so a 90-column level still shows
// every trap at 360px. Numbers and fixed colors only — never level text —
// so the markup is safe to assign with innerHTML.
const TOP_Y = GROUND_TOP_Y - 240; // highest point drawn (platforms, flyers)
const HAZARD_COLORS: Partial<Record<ObjectType, string>> = {
  candle: '#ffb347', saw: '#d9d9d9', movingSaw: '#d9d9d9', bat: '#b36bff', ghost: '#e0f7ff', fallingBlock: '#8a7f99',
};
const MARKER_R = 3.5;

export function renderCoursePreviewSvg(preview: CoursePreview, widthPx: number, heightPx: number): string {
  const inset = MARKER_R + 1;
  const scaleX = (widthPx - inset * 2) / Math.max(1, preview.width);
  const sx = (x: number) => (inset + x * scaleX).toFixed(1);
  const groundY = heightPx - 6;
  const sy = (y: number) => Math.max(MARKER_R, Math.min(groundY, groundY - ((GROUND_TOP_Y - y) / (GROUND_TOP_Y - TOP_Y)) * (groundY - MARKER_R))).toFixed(1);
  const parts: string[] = [];
  for (const [from, to] of preview.ground) {
    parts.push(`<rect x="${sx(from)}" y="${groundY}" width="${(Math.max(0, to - from) * scaleX).toFixed(1)}" height="6" fill="#39ff88"/>`);
  }
  for (const p of preview.platforms) {
    parts.push(`<rect x="${sx(p.x - 30)}" y="${sy(p.y)}" width="${(60 * scaleX).toFixed(1)}" height="3" fill="#6f8f7a"/>`);
  }
  for (const h of preview.hazards) {
    parts.push(`<circle cx="${sx(h.x)}" cy="${(Number(sy(h.y)) - MARKER_R).toFixed(1)}" r="${MARKER_R}" fill="${HAZARD_COLORS[h.type] ?? '#ff3b5c'}" stroke="#000" stroke-width="1"/>`);
  }
  parts.push(`<rect x="${sx(preview.finishX)}" y="${groundY - 14}" width="3" height="14" fill="#ffd166"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" aria-hidden="true">${parts.join('')}</svg>`;
}
```

- [ ] **Step 4: Run the tests.** Run `npm run test:unit && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Render the course preview as an SVG silhouette".

---

### Task 3: Feed card bottom strip (tagline + preview)

**Files:**
- Modify: `src/client/splash.html`, `src/client/splash.css`, `src/client/splash.ts`

**Interfaces:**
- Consumes: `GET /api/levels/:levelId/preview` (Task 1) and `renderCoursePreviewSvg` (Task 2).

- [ ] **Step 1: Markup.** In `splash.html`, add a sibling **after** `.scene` inside `.card` (so it's outside the art):

```html
<div class="course-strip">
  <div class="course-tagline">Beat the level. Add your curse. Let Reddit deal with it.</div>
  <div class="course-preview" id="course-preview" aria-hidden="true"></div>
</div>
```

- [ ] **Step 2: Styles.** Append to `splash.css`:

```css
/* Tagline + course silhouette, below the art — never over it. The card is
   a flex column, so this strip takes its height from the scene. */
.course-strip {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 12px 8px;
  background: #0d0d16;
  border-top: 2px solid #000000;
}
.course-tagline {
  color: #ffffff;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-align: center;
  text-shadow: 1px 1px 0 #000000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.course-preview { height: 30px; }
@media (max-width: 380px) { .course-tagline { font-size: 9.5px; } }
```

- [ ] **Step 3: Script.** In `splash.ts`, after `loadStats`, add the code below and call `void loadPreview();`. Also add `import { isCoursePreview, type CoursePreview } from '../shared/coursePreview';` and `import { renderCoursePreviewSvg } from './ui/coursePreviewSvg';`.

```ts
const previewEl = requireElement('course-preview');
let preview: CoursePreview | undefined;
function drawPreview(): void {
  if (!preview) return;
  previewEl.innerHTML = renderCoursePreviewSvg(preview, previewEl.clientWidth, 30);
}
async function loadPreview(): Promise<void> {
  try {
    const response = await fetch(`/api/levels/${encodeURIComponent(levelId)}/preview`, { signal: AbortSignal.timeout(8000) });
    const body: unknown = await response.json();
    if (!response.ok || !isCoursePreview(body)) return;
    preview = body;
    drawPreview();
  } catch {
    // The strip keeps its tagline; PLAY works either way.
  }
}
window.addEventListener('resize', drawPreview);
```

- [ ] **Step 4: Verify.** Run `npm run build`. Then serve `dist/client` and open `splash.html` with Playwright at 700×300 and 360×300, routing `**/api/levels/*/preview` to a Meat Grinder preview built with `buildCoursePreview` from the seed level. Take screenshots and check:
  - nothing overlaps the artwork;
  - the tagline is fully visible at 700px and fits (or is cleanly cut with an ellipsis) at 360px;
  - every hazard marker is visible;
  - there's no horizontal scroll.

  Then run `node tools/check-client-build.mjs`. Expected: the size limits still pass.
- [ ] **Step 5: Commit** with the message "Feed card: tagline and course silhouette strip below the art".

---

### Task 4: Built-in starter level that can't be cursed

**Files:**
- Modify: `src/shared/constants.ts`, `src/server/core/seedLevels.ts`, `src/server/routes/curse.ts`, `src/server/services/DailyService.ts`, `src/client/game/scenes/GameScene.ts`
- Test: `src/server/tests/funnel.test.ts` for the level's shape, and `src/server/tests/regressions.test.ts` for the curse and daily routes. Those routes already have mocks there: `proposeCurse` and `browse` helpers.

**Interfaces:**
- Produces: `STARTER_LEVEL_ID = 'first-blood'` and `CURSE_LOCKED_LEVEL_IDS: ReadonlySet<string>` (in `src/shared/constants.ts`); `SEED_LEVELS['first-blood']`; `SEED_TITLES['first-blood'] = 'First Blood'`.

- [ ] **Step 1: Write the failing tests**

In `funnel.test.ts`:
```ts
import { SEED_LEVELS } from '../core/seedLevels';
import { CURSE_LOCKED_LEVEL_IDS, STARTER_LEVEL_ID } from '../../shared/constants';

await test('First Blood is seeded, jump-only, and curse-locked', () => {
  const starter = SEED_LEVELS[STARTER_LEVEL_ID];
  assert.ok(starter);
  assert.ok(CURSE_LOCKED_LEVEL_IDS.has(STARTER_LEVEL_ID));
  assert.equal(
    starter.objects.some((o) => o.type === 'ghost' || o.type === 'bat' || o.type === 'movingSaw'),
    false,
    'no hazards that move or punish jumping'
  );
  assert.ok(starter.objects.every((o) => o.addedBy === SEED_AUTHOR));
});
```

In `regressions.test.ts`, next to the existing curse tests:
```ts
await test('the starter level cannot be cursed', async () => {
  await ready('alice');
  const response = await proposeCurse('alice', STARTER_LEVEL_ID /* match the helper's signature */);
  assert.equal(response.status, 403);
});
```
Read the existing `proposeCurse` helper (around line 246) and pass the same arguments the other curse tests use, with the level id swapped for `STARTER_LEVEL_ID`.

- [ ] **Step 2: Run them to confirm they fail.** Run `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement**

`constants.ts`:
```ts
// The built-in easy course new players get after the tutorial (hub post)
// or when they're struggling on a community level. Locked against curses
// so it stays forgiving forever.
export const STARTER_LEVEL_ID = 'first-blood';
export const CURSE_LOCKED_LEVEL_IDS: ReadonlySet<string> = new Set([STARTER_LEVEL_ID]);
```

`seedLevels.ts`: add a jump-only level built with the file's own `groundStrip(startX, widthPx)`/`placed`/`level` helpers. Geometry below. Each obstacle has at least 400px of run-up after the previous one, and the gap is 120px, which a 60ms tap clears (verified for 180px or less in the 2026-09-27 sweep):
```ts
const firstBlood = level(
  STARTER_LEVEL_ID,
  [
    ...groundStrip(0, 1500),
    ...groundStrip(1620, 1680),
    placed('fb-spawn', 'spawn', 80, GROUND_TOP_Y),
    placed('fb-candle-1', 'candle', 600, GROUND_TOP_Y),
    placed('fb-candle-2', 'candle', 1080, GROUND_TOP_Y),
    placed('fb-shield', 'shield', 1860, GROUND_TOP_Y),
    placed('fb-saw-1', 'saw', 2160, GROUND_TOP_Y),
    placed('fb-candle-3', 'candle', 2640, GROUND_TOP_Y),
    placed('fb-finish', 'finish', 3180, GROUND_TOP_Y),
  ],
  6000
);
```
Register `[firstBlood.levelId]: firstBlood` in `SEED_LEVELS` and `'First Blood'` in `SEED_TITLES`. Import `STARTER_LEVEL_ID`.

`curse.ts` `/propose`: straight after `isProposeCurseBody(body)` passes:
```ts
if (CURSE_LOCKED_LEVEL_IDS.has(body.levelId)) {
  return c.json<ErrorResponse>({ status: 'error', message: "This level can't be cursed." }, 403);
}
```
Add the same check to `/publish`, using the candidate's `levelId`.

`DailyService.postLevelOfTheDay`: filter `levels` to `levels.filter((l) => !CURSE_LOCKED_LEVEL_IDS.has(l.levelId))` before picking.

`GameScene`: find where `setCurseHandler` is called (about line 822) and wrap it in `if (!CURSE_LOCKED_LEVEL_IDS.has(request.levelId))`.

- [ ] **Step 4: Browser check that First Blood can be beaten by tapping.** In `tools/game-regressions.mjs`, add a block that:
  - routes `/api/levels/first-blood` to the seed JSON (import it from the built server? No: inline the same object literal from `seedLevels.ts` into the test);
  - starts `GameScene` with `{ levelId: 'first-blood' }`;
  - drives input with `scene.events.emit('jumpdown')`, then `'jumpup'` after 60ms, at player x = obstacle x − 80 for each candle and the saw, and at x = 1470 for the gap;
  - asserts `runEnded && !player.alive === false` (that is, the finish was reached).

  Run `npm run build && npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Run everything.** Run `npm run test:unit && npm run test:types && npm run lint`, then commit with the message "Add First Blood, a built-in starter level that can't be cursed".

---

### Task 5: Routing: tutorial → starter on the hub, struggle offer on level posts

**Files:**
- Create: `src/client/ui/StarterOffer.ts`
- Modify: `src/client/game/scenes/GameScene.ts`, `src/client/game.html`, `src/client/game.css`, `src/shared/constants.ts`
- Test: `tools/game-regressions.mjs`

**Interfaces:**
- Consumes: `STARTER_LEVEL_ID` (Task 4), and `isTutorialDone`/`markTutorialDone` (`src/client/game/levels/tutorial.ts`).
- Produces: a new optional field on `GameSceneData`, `returnTo?: { levelId: string; title: string }`; constants `STRUGGLE_DEATHS = 8` and `STRUGGLE_MAX_PROGRESS = 0.5`; and a `StarterOffer` class with `show(onAccept: () => void): void` and `hide(): void`.

- [ ] **Step 1: Write the failing browser test** in `tools/game-regressions.mjs`, next to the existing tutorial-routing block:
  1. **Hub path.** Fresh page, no `?level`, with `/api/levels/@today` routed to a real level. Click Play, then click Skip Tutorial. Assert `GameScene.levelVersion.levelId === 'first-blood'`. Call `onFinishReached(true)` and assert `#run-result-next` has the text "Next Level" and `#run-result-next-status` contains "Today". Click it and assert the next level id is the `@today` level.
  2. **Level-post path.** Fresh page with `?level=real` and `cursed:tutorial-done=1` set. Call `onPlayerDied()` 8 times, restarting in between. Assert `#starter-offer` is visible. Click it, assert the level is `first-blood`, then `onFinishReached(true)`, and assert Next says "Back to real".
  3. With fewer than 8 deaths, `#starter-offer` stays hidden.

- [ ] **Step 2: Run it to confirm it fails.** Run `npm run build && npm run test:browser`. Expected: FAIL at step 1's assertion.
- [ ] **Step 3: Implement**
  - In `constants.ts`, add `STRUGGLE_DEATHS = 8` and `STRUGGLE_MAX_PROGRESS = 0.5`, with a comment: "offer the starter after this many deaths on one level while best distance is under half".
  - Add `returnTo` to `GameSceneData` and a `private returnTo: { levelId: string; title: string } | undefined` field, set in `init()`.
  - Replace `leaveTutorial()` with:
    ```ts
    private leaveTutorial(): void {
      markTutorialDone();
      const destination = this.explicitLevelId ?? getRequestedLevelId();
      if (destination === HUB_LEVEL_ID) {
        this.scene.start('GameScene', { levelId: STARTER_LEVEL_ID, returnTo: { levelId: HUB_LEVEL_ID, title: "Today's level" } });
        return;
      }
      this.scene.start('GameScene', { levelId: this.explicitLevelId });
    }
    ```
  - At the top of `findNextLevel()`, add:
    ```ts
    if (this.returnTo) {
      const { levelId, title } = this.returnTo;
      const label = levelId === HUB_LEVEL_ID ? 'Next Level' : `Back to ${title}`;
      this.resultOverlay.showNext(`Up next: ${title}`, label, () => this.scene.start('GameScene', { levelId }));
      return;
    }
    ```
  - Create `StarterOffer.ts`. It's a DOM singleton with the same pattern as `PreviewBackButton`, around `#starter-offer` / `#starter-offer-btn`. `show(onAccept)` makes it visible and sets the click handler, then auto-hides after 8000ms (`window.setTimeout`, cleared in `hide`).
  - In `game.html`, next to `#death-toast`, add:
    ```html
    <div id="starter-offer" class="hidden"><button type="button" id="starter-offer-btn">Too tough? Warm up on an easy course →</button></div>
    ```
  - In `game.css`, position `#starter-offer` at `bottom: max(16px, env(safe-area-inset-bottom))`, centered, with `pointer-events: none` on the wrapper and `pointer-events: auto` on the button. Use `#starter-offer.hidden { display: none; visibility: hidden; }`. Also add `#starter-offer` to the "faded-out DOM overlays" selector list in `regressions.test.ts` if it fades.
  - In `onPlayerDied`, after `recordBestProgress(...)`:
    ```ts
    const level = this.levelVersion;
    if (level && !this.previewLevel && !this.returnTo && !this.starterOffered &&
        !CURSE_LOCKED_LEVEL_IDS.has(level.levelId) &&
        this.deathsThisLevel >= STRUGGLE_DEATHS && (this.bestProgress ?? 0) < STRUGGLE_MAX_PROGRESS) {
      this.starterOffered = true;
      const title = this.levelStats?.title ?? level.levelId;
      StarterOffer.instance().show(() =>
        this.scene.start('GameScene', { levelId: STARTER_LEVEL_ID, returnTo: { levelId: level.levelId, title } })
      );
    }
    ```
    `starterOffered` is a boolean field. Reset it in `init()` only when the level id changes (compare with a module-level `lastOfferLevelId`), so it's offered once per level per session.
  - In `cleanup()`, call `StarterOffer.instance().hide()`.
- [ ] **Step 4: Run the tests.** Run `npm run build && npm run test:browser && npm run test:unit && npm run test:types && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Route new players tutorial → First Blood, and offer it when struggling".

---

### Task 6: "Leave Your Curse" next to "Next Level"

**Files:**
- Modify: `src/client/game.html` (the `#run-result-actions` block), `src/client/game.css`
- Test: `tools/game-regressions.mjs`

- [ ] **Step 1: Write the failing test.** After a real (non-preview) clear on a stub level, both `#run-result-curse-btn` (text `Leave Your Curse`) and `#run-result-next` are visible, and their bounding boxes share a row (`Math.abs(a.y - b.y) < 4`) at 844×390. At 390×844 they may stack.
- [ ] **Step 2: Run it to confirm it fails.** Expected: the button text is "Curse This Level?", and they're stacked.
- [ ] **Step 3: Implement.**
  - Change the curse button's text to `Leave Your Curse`.
  - Move `#run-result-next` directly after it inside a new `<div id="run-result-primary">` wrapper. Leave Share where it is.
  - CSS: `#run-result-primary { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }`, with both buttons at `min-width: 150px`.
  - Keep the existing `editor-btn-curse` style so it reads as the mischievous option.
- [ ] **Step 4: Run** `npm run build && npm run test:browser`. Then check the existing `every editor/curse toolbar button id … exists in game.html` unit test still passes (`npm run test:unit`).
- [ ] **Step 5: Commit** with the message "Present Leave Your Curse alongside Next Level after a clear".

---

### Task 7: Track who each curse caught and who got past it (server)

**Files:**
- Create: `src/shared/trapStats.ts`, `src/shared/myCursesApi.ts`, `src/server/services/TrapStatsService.ts`, `src/server/routes/myCurses.ts`
- Modify: `src/server/core/redisKeys.ts`, `src/server/routes/runs.ts` (trap-kill and the clear), `src/server/routes/deaths.ts`, `src/server/routes/curse.ts` (publish tx), `src/server/index.ts`
- Test: `src/server/tests/funnel.test.ts` (pure parts), and a new `src/server/tests/myCurses.test.ts` that copies `deaths.test.ts`'s in-memory Redis mock and adds `hSet`/`hGet`/`hGetAll`/`hLen`/`hIncrBy`.

**Interfaces:**
- Produces:
  - `userCursesKey(u)` → `user:${u}:curses`, a hash of objectId → JSON `{ levelId, type, placedAt }`
  - `trapCaughtByKey(id)` → `trap:${id}:caughtBy`, a hash of username → count
  - `trapPassedByKey(id)` → `trap:${id}:passedBy`, a hash of username → '1'
  - `userCursesSeenKey(u)` → `user:${u}:cursesSeen`, a hash of objectId → JSON `{ caught, passed }`
  - `passedHazardIds(objects: LevelObject[], reachedX: number | 'clear', username: string): string[]`
  - TrapStatsService: `recordCatch(objectId: string, addedBy: string, username: string): Promise<void>`; `recordPasses(levelId: string, version: number, username: string, reachedX: number | 'clear'): Promise<void>`; `getMyCurses(username: string): Promise<MyCurse[]>`; `markCursesSeen(username: string): Promise<void>`
  - `type MyCurse = { objectId: string; levelId: string; levelTitle: string; type: ObjectType; placedAt: number; caught: number; passed: number; newCaught: number; newPassed: number }`, plus `type MyCursesResponse = { curses: MyCurse[] }` and `isMyCursesResponse`
  - Routes: `GET /api/me/curses` → `MyCursesResponse` (401 if signed out), and `POST /api/me/curses/seen` → `{ ok: true }`

- [ ] **Step 1: Write the failing pure tests** (`funnel.test.ts`)

```ts
import { passedHazardIds } from '../../shared/trapStats';

await test('passes count only other players\' traps fully behind the player', () => {
  const objects = [
    obj('a', 'candle', 300, GROUND_TOP_Y, 'bob'),
    obj('b', 'saw', 600, GROUND_TOP_Y, 'bob'),
    obj('mine', 'candle', 200, GROUND_TOP_Y, 'alice'),
    obj('seed', 'candle', 100),
    obj('pw', 'shield', 150, GROUND_TOP_Y, 'bob'),
  ];
  assert.deepEqual(passedHazardIds(objects, 400, 'alice'), ['a']);
  assert.deepEqual(passedHazardIds(objects, 620, 'alice'), ['a'], 'still inside the saw cell');
  assert.deepEqual(passedHazardIds(objects, 'clear', 'alice').sort(), ['a', 'b']);
});
```

- [ ] **Step 2: Write the failing route tests** (`myCurses.test.ts`, using the `deaths.test.ts` mock pattern):
  - Publishing a curse (call `recordCursePlaced` directly on the service, or run the full propose→verify→publish helpers if you copy them) makes `GET /api/me/curses` list it with `caught: 0, passed: 0`.
  - `recordCatch('obj', 'alice', 'bob')` twice, then `recordCatch('obj', 'alice', 'carol')`, gives `caught === 2` (unique players).
  - `recordCatch('obj', 'alice', 'alice')` does nothing (self).
  - `recordPasses` with `'clear'` marks every other player's hazard.
  - After `POST /seen`, `newCaught === 0`. One more catch then gives `newCaught === 1`.
  - Signed out gives 401 on both routes.
- [ ] **Step 3: Run them to confirm they fail.** Run `npm run test:unit`. Expected: FAIL.
- [ ] **Step 4: Implement**

`src/shared/trapStats.ts`:
```ts
import { GRID_CELL_SIZE, SEED_AUTHOR } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelObject } from './types';

// Which other players' traps a run got past: fully behind the furthest x
// it reached (a whole cell clear of the trap's center, so dying ON a trap
// never counts as passing it), or every one of them on a clear. A bat's
// or moving saw's start position stands in for where it is.
export function passedHazardIds(objects: LevelObject[], reachedX: number | 'clear', username: string): string[] {
  return objects
    .filter((o) => HAZARD_TYPES.has(o.type) && o.addedBy !== SEED_AUTHOR && o.addedBy !== username)
    .filter((o) => reachedX === 'clear' || o.x + GRID_CELL_SIZE <= reachedX)
    .map((o) => o.id);
}
```

`TrapStatsService.ts`, sketched with exact calls:
```ts
export async function recordCatch(objectId: string, addedBy: string, username: string): Promise<void> {
  if (addedBy === username || addedBy === SEED_AUTHOR) return;
  await redis.hIncrBy(trapCaughtByKey(objectId), username, 1);
}
export async function recordPasses(levelId: string, version: number, username: string, reachedX: number | 'clear'): Promise<void> {
  const raw = await redis.get(levelVersionKey(levelId, version));
  if (raw === undefined) return;
  const parsed: unknown = JSON.parse(raw);
  if (!isLevelVersion(parsed)) return;
  await Promise.all(passedHazardIds(parsed.objects, reachedX, username).map((id) => redis.hSet(trapPassedByKey(id), { [username]: '1' })));
}
export function cursePlacedFields(objectId: string, levelId: string, type: ObjectType): Record<string, string> {
  return { [objectId]: JSON.stringify({ levelId, type, placedAt: Date.now() }) };
}
export async function getMyCurses(username: string): Promise<MyCurse[]> {
  const placed = await redis.hGetAll(userCursesKey(username));
  const seen = await redis.hGetAll(userCursesSeenKey(username));
  const rows = await Promise.all(Object.entries(placed).map(async ([objectId, json]) => {
    const meta: unknown = JSON.parse(json);
    if (!isPlacedCurse(meta)) return undefined;           // local guard: { levelId: string; type: string; placedAt: number }
    const [caught, passed, stats] = await Promise.all([
      redis.hLen(trapCaughtByKey(objectId)), redis.hLen(trapPassedByKey(objectId)), getLevelStats(meta.levelId),
    ]);
    const before = parseSeen(seen[objectId]);             // local guard, defaults { caught: 0, passed: 0 }
    return { objectId, levelId: meta.levelId, levelTitle: stats?.title ?? meta.levelId, type: meta.type, placedAt: meta.placedAt,
      caught, passed, newCaught: Math.max(0, caught - before.caught), newPassed: Math.max(0, passed - before.passed) };
  }));
  return rows.filter((r): r is MyCurse => r !== undefined).sort((a, b) => b.placedAt - a.placedAt).slice(0, 20);
}
export async function markCursesSeen(username: string): Promise<void> {
  const curses = await getMyCurses(username);
  if (curses.length === 0) return;
  await redis.hSet(userCursesSeenKey(username), Object.fromEntries(curses.map((c) => [c.objectId, JSON.stringify({ caught: c.caught, passed: c.passed })])));
}
```
`isPlacedCurse` must also check that `type` is an `ObjectType`. Add `isObjectType` to `src/shared/types.ts` if one doesn't exist yet: a guard over the `ObjectType` union written as a `Set<string>` of its members.

Wiring:
- `curse.ts` publish tx, next to `tx.set(levelCurrentVersionKey…)`: `await tx.hSet(userCursesKey(username), cursePlacedFields(newObject.id, levelId, newObject.type));` Add `userCursesKey(username)` to the watched key list.
- `runs.ts` trap-kill, after its transaction commits: `await recordCatch(object.id, object.addedBy, username).catch(() => undefined);`
- `runs.ts` clear, after the transaction, only when the run is valid (reuse the same `levelId`/`version` the handler validated): `await recordPasses(levelId, version, username, 'clear').catch(() => undefined);`
- `deaths.ts` POST, after `zIncrBy`: `await recordPasses(levelId, version, username, body.x).catch(() => undefined);`
- `myCurses.ts` Hono router with the two routes; mount it with `app.route('/api/me/curses', myCurses)` in `index.ts`.

- [ ] **Step 5: Run everything.** Run `npm run test:unit && npm run test:types && npm run lint`. Expected: PASS.
- [ ] **Step 6: Commit** with the message "Track unique players each curse caught and let past, per player".

Note for the reviewer: curses placed before this ships aren't in anyone's list (there's no backfill). If the user wants them, a one-off mod-menu backfill can walk each level's versions (`addedObjectId` + `contributorUsername`), but that's out of scope here.

---

### Task 8: Guided first curse (three picks, three suggested spots)

**Files:**
- Create: `src/shared/curseSuggestions.ts`
- Modify: `src/client/game/scenes/CurseScene.ts`, `src/client/ui/CurseToolbar.ts`, `src/client/game.html` (curse toolbar), `src/client/game.css`
- Test: `src/server/tests/funnel.test.ts` (pure) and `tools/game-regressions.mjs` (UI)

**Interfaces:**
- Consumes: `GET /api/me/curses` (Task 7) to decide guided mode (the list is empty), and `HAZARD_TYPES`.
- Produces: `suggestCurseCells(objects: LevelObject[], count: number): { x: number; y: number }[]`; `GUIDED_CURSE_TYPES: ObjectType[] = ['candle', 'saw', 'ghost']`; `CurseToolbar.setGuided(enabled: boolean, onMoreOptions: () => void): void`.

- [ ] **Step 1: Write the failing pure tests**

```ts
import { suggestCurseCells } from '../../shared/curseSuggestions';

await test('suggestions sit on open ground, away from spawn, finish, gaps and other traps', () => {
  const objects = [...groundTiles(0, 1800), ...groundTiles(1920, 3000),
    obj('s', 'spawn', 90), obj('f', 'finish', 2910), obj('c', 'candle', 1230)];
  const cells = suggestCurseCells(objects, 3);
  assert.equal(cells.length, 3);
  for (const { x, y } of cells) {
    assert.equal(y, GROUND_TOP_Y);
    assert.ok(x >= 90 + 4 * GRID_CELL_SIZE, 'clear of spawn');
    assert.ok(x <= 2910 - 3 * GRID_CELL_SIZE, 'clear of finish');
    assert.ok(Math.abs(x - 1230) > 2 * GRID_CELL_SIZE, 'clear of the existing candle');
    assert.ok(x < 1800 - GRID_CELL_SIZE || x > 1920 + GRID_CELL_SIZE, 'not on a gap edge');
  }
  assert.ok(cells[1].x - cells[0].x >= 4 * GRID_CELL_SIZE, 'spread out');
});

await test('suggestions degrade to fewer (or none) on a cramped level', () => {
  assert.deepEqual(suggestCurseCells([...groundTiles(0, 480), obj('s', 'spawn', 90), obj('f', 'finish', 420)], 3), []);
  assert.deepEqual(suggestCurseCells([], 3), []);
});
```

- [ ] **Step 2: Run them to confirm they fail.** Run `npm run test:unit`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/shared/curseSuggestions.ts`

```ts
import { GRID_CELL_SIZE, GROUND_TOP_Y } from './constants';
import { HAZARD_TYPES } from './hazards';
import type { LevelObject, ObjectType } from './types';

// The three traps offered to a first-time curser, and where to suggest
// placing one. Suggestions are hints only — a curse can still go anywhere.
export const GUIDED_CURSE_TYPES: ObjectType[] = ['candle', 'saw', 'ghost'];

export function suggestCurseCells(objects: LevelObject[], count: number): { x: number; y: number }[] {
  const cell = GRID_CELL_SIZE;
  const spawnX = objects.find((o) => o.type === 'spawn')?.x;
  const finishX = objects.find((o) => o.type === 'finish')?.x;
  if (spawnX === undefined || finishX === undefined) return [];
  const groundXs = new Set(objects.filter((o) => o.type === 'ground').map((o) => o.x));
  const others = objects.filter((o) => HAZARD_TYPES.has(o.type) || o.type === 'platform' || o.type === 'movingPlatform');
  const candidates = [...groundXs].sort((a, b) => a - b).filter((x) =>
    x >= spawnX + 4 * cell && x <= finishX - 3 * cell &&
    groundXs.has(x - cell) && groundXs.has(x + cell) &&
    others.every((o) => Math.abs(o.x - x) > 2 * cell));
  if (candidates.length === 0) return [];
  const picks: number[] = [];
  const n = Math.min(count, candidates.length);
  for (let i = 0; i < n; i++) {
    const x = candidates[Math.floor(((i + 0.5) * candidates.length) / n)];
    if (x !== undefined && picks.every((p) => Math.abs(p - x) >= 4 * cell)) picks.push(x);
  }
  return picks.map((x) => ({ x, y: GROUND_TOP_Y }));
}
```

UI:
- `game.html`: inside `#curse-row`, add `<button type="button" id="curse-more-options" class="editor-btn hidden">More options</button>`. Also add its id to the toolbar-ids unit test list if that test enumerates ids.
- `CurseToolbar.setGuided(enabled, onMoreOptions)`: when enabled, hide the three category buttons, show only the `curse-type-*` buttons for `GUIDED_CURSE_TYPES`, show `#curse-more-options` (its click calls `onMoreOptions`, which calls `setGuided(false, …)` and restores the normal category view via the existing `setActiveCategory(undefined)`/`setTypesForCategory(undefined)`), and call `showMessage('Pick a trap, then tap a glowing spot — or anywhere you like.')`.
- `CurseScene.create()`: after the level loads, `fetch('/api/me/curses')`. If `isMyCursesResponse(body) && body.curses.length === 0`, set `this.guided = true`, call `toolbar.setGuided(true, () => { this.guided = false; this.redrawSuggestions(); })`, compute `this.suggestions = suggestCurseCells(this.baseObjects /* the published level's objects */, 3)`, and call `redrawSuggestions()`. On any fetch failure, stay unguided.
- `redrawSuggestions()`: destroy the previous markers. If `this.guided && !this.pending`, draw a `Graphics` rounded-rect outline (2px, `0x39ff88`) one cell in size, bottom-anchored at each suggestion. Tween each marker's alpha 0.35↔1 over 700ms, yoyo, repeat -1. Call it after `setPendingAt` and `clearPending` too. Tap handling stays **unchanged**: tapping any cell places there.
- [ ] **Step 4: Browser test.**
  - Route `/api/me/curses` to `{ curses: [] }` and start `CurseScene` with a stub level. Assert `#curse-more-options` is visible, only the candle/saw/ghost type buttons are visible, and `scene.suggestions.length` is between 1 and 3.
  - Tap a **non-suggested** cell with candle selected, and assert `scene.pending` exists (placement anywhere still works).
  - Route `{ curses: [one] }` and assert guided mode is off.
- [ ] **Step 5: Run everything.** Run `npm run build && npm run test:browser && npm run test:unit && npm run test:types && npm run lint`, then commit with the message "Guide a player's first curse with three picks and suggested spots".

---

### Task 9: "Your curses" feedback in the game

**Files:**
- Modify: `src/client/ui/GameMenu.ts`, `src/client/ui/StatsOverlay.ts`, `src/client/game.html` (stats chip + stats overlay), `src/client/game.css`
- Test: `tools/game-regressions.mjs`

**Interfaces:**
- Consumes: `GET /api/me/curses`, `POST /api/me/curses/seen`, `isMyCursesResponse` (Task 7), `labelFor`.
- Produces: `curseFeedbackLine(c: MyCurse): string` (export it from `StatsOverlay.ts`), returning ``Your ${labelFor(c.type)} caught ${c.caught} player${c.caught === 1 ? '' : 's'}. ${c.passed} made it through.``

- [ ] **Step 1: Write the failing test.**
  - Route `/api/me/curses` to two curses, one with `newCaught: 3`, and `/api/stats/me` to valid stats. Open the main menu.
  - Assert `#game-menu-stats-badge` is visible with the text `3 new`.
  - Click `#game-menu-stats-chip` and assert `#stats-curses` has 2 rows, the first containing `Your Candle caught 8 players. 12 made it through.` and `on Meat Grinder`.
  - Assert a `POST /api/me/curses/seen` was made, and that the badge is hidden after the overlay closes.
  - Route an empty list and assert the badge is hidden and `#stats-curses` shows `No curses yet — beat a level and leave one.`
- [ ] **Step 2: Run it to confirm it fails.**
- [ ] **Step 3: Implement.**
  - `game.html`: inside `#game-menu-stats-chip`, add `<span id="game-menu-stats-badge" class="hidden"></span>`. In the stats overlay, above `#stats-list`, add a section `<h3>Your curses</h3><ol id="stats-curses"></ol>`.
  - `GameMenu.show()`: fetch `/api/me/curses`. Sum `newCaught + newPassed`, and if it's more than 0, show the badge with the text `${total} new` (with `textContent`, never `innerHTML`).
  - `StatsOverlay.show()`: fetch `/api/me/curses` alongside the existing stats fetch. Render up to 10 `<li>` rows with `textContent`:
    - line 1: `curseFeedbackLine(c)`;
    - line 2: `on ${c.levelTitle}`;
    - plus a `+${c.newCaught} caught · +${c.newPassed} through` pill when either count is above 0.
  - Then `POST /api/me/curses/seen` (fire and forget), and on close hide the chip badge.
  - Style it to match the existing stats rows.
- [ ] **Step 4: Run** `npm run build && npm run test:browser && npm run test:types && npm run lint`.
- [ ] **Step 5: Commit** with the message "Show each curse's catches and survivors inside the game".

---

### Task 10: End-to-end verification

- [ ] **Step 1:** Run `npm run check:production && npm run test:browser`. Everything must pass.
- [ ] **Step 2: Headless playthrough of the whole funnel** at 390×844 and 844×390, using the harness pattern in memory (`playtest_harness_notes.md`: build, stub `/api`, Playwright, `window.__PHASER_GAME__`). The path is: splash, Play, tutorial, First Blood clear, Next Level, a clear on the stub level, Leave Your Curse, guided mode, place on a suggested spot, Prove It (use the dev warp or emit a finish), publish (stub), then the menu showing the STATS badge after the stubbed counters change. Screenshot each beat and check:
  - no overlap with the artwork or top buttons;
  - every piece of copy matches the Global Constraints exactly.
- [ ] **Step 3:** Screenshot the splash at 700px and 360px, and compare it with the pre-change splash.
- [ ] **Step 4:** Record the commits in `git_commit_log.md` (memory) and update the phase note in `cursed_phased_plan.md`.

---

## Source brief (user, 2026-09-27)

> The feed card explains the hook. Keep Play prominent, but add: "Beat the level. Add your curse. Let Reddit deal with it." Show a preview of the course so people understand what they're opening.
>
> Their first run gives them a manageable challenge. Your tutorial already teaches jumping. Follow it with a short, forgiving course where a beginner can get a win within a few attempts. For players opening a specific community level, preserve that destination and offer an easy starter if they struggle.
>
> A death introduces the other player. You already show "Killed by u/Someone's Saw." That's the moment the obstacles become someone else's mischief. Keep the immediate respawn so the joke doesn't interrupt playing.
>
> Their first win makes contributing feel easy. Present "Leave your curse" alongside "Next level." For that first contribution, offer a small selection of objects and suggested placements. They place one, prove the course is beatable, and publish. Your existing curse flow supplies most of this.
>
> Their contribution gives them a reason to return. Once actual attempts come in, show something like "Your candle caught 8 players. 12 made it through." Put that feedback inside the game so their contribution feels remembered.

Coverage: beat 1 → Tasks 1–3. Beat 2 → Tasks 4–5. Beat 3 → already shipped (death toast + instant respawn, commits 83869b9/0256600); no task. Beat 4 → Tasks 6 and 8 (the existing curse, Prove It and publish flow does the rest). Beat 5 → Tasks 7 and 9.
