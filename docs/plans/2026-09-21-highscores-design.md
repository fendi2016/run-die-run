# Highscores — Design

**Spec:** [`build for run die run.md`](../../build%20for%20run%20die%20run.md) doesn't cover this feature — it only specs per-level, time-based version leaderboards (section 9). Highscores is a new, separate system layered on top of the existing curse/trap-kill mechanic.

## Summary

Two global (subreddit-wide, not per-level) leaderboards ranking players by **curse kills** — the count of other players killed by traps/hazards that player has placed, across every level (built-in and user-published alike):

- **Daily**: resets every 24 hours. A scheduled job rotates it — archiving the outgoing period's final standings onto the old Reddit post (which freezes into a read-only record of that day) and spawning a fresh post to host the new period.
- **Permanent**: accumulates forever, never resets.

This reuses the existing curse/trap-kill mechanic (`src/server/routes/runs.ts`'s `/trap-kill` handler) as the sole source of score — no new gameplay mechanic, no new client-side scoring logic.

## Score source and self-kill guard

`/trap-kill` already runs one atomic transaction (`withTransaction`) that credits a trap's owner (`object.addedBy`) with a kill whenever another player dies on it. Two more writes join that same transaction:

- `tx.zIncrBy(highscoresDailyKey(currentPeriod), object.addedBy, 1)`
- `tx.zIncrBy(highscoresPermanentKey(), object.addedBy, 1)`

Both are skipped when `username === object.addedBy` (the victim killed themselves on their own trap) — otherwise a player could publish a trivial level, curse it themselves, and farm their own highscore by repeatedly dying on it. This guard applies **only** to the two new highscore counters. The pre-existing per-level counters (`trapKillsKey`, `userContributionsKey`, `levelContributorKillsKey`) keep their current behavior (which already permits self-kills) — explicitly out of scope here, per product decision, since it's a separate pre-existing stat, not the new competitive leaderboard.

No anti-collusion measures (two accounts trading kills on a trivial level) — consistent with the codebase's existing anti-cheat philosophy ("build reasonable server authority first, don't spend weeks on anti-cheat before the core game is proven", `runs.ts`).

## Period boundaries

Rotation happens once daily at a fixed **14:00 UTC** (8am CST; becomes 9am during CDT since Devvit cron has no timezone/DST support — accepted tradeoff). Period numbers are computed from wall-clock time, anchored to that same boundary, so no stored "current period" pointer is needed and the score-write path and the rotation job can never disagree about which period is "current":

```ts
// src/server/core/highscorePeriod.ts
const DAY_MS = 24 * 60 * 60 * 1000;
const ROTATION_OFFSET_MS = 14 * 60 * 60 * 1000; // 14:00 UTC

export function highscorePeriodNumber(timestamp: number = Date.now()): number {
  return Math.floor((timestamp - ROTATION_OFFSET_MS) / DAY_MS);
}

export function highscorePeriodEndsAt(periodNumber: number): number {
  return periodNumber * DAY_MS + ROTATION_OFFSET_MS + DAY_MS;
}
```

A period's sorted set is simply abandoned once rotated past — nothing needs to actively clear it. A short TTL (3 days) is set on daily keys purely for Redis hygiene, not for correctness (the archive snapshot is what's authoritative after rotation, not the live sorted set).

## Redis schema (additions to `redisKeys.ts`)

```ts
export const highscoresDailyKey = (periodNumber: number): string =>
  `highscores:daily:${periodNumber}`;

export const highscoresPermanentKey = (): string => `highscores:permanent`;

export const highscoresLivePostKey = (): string => `highscores:livePostId`;

export const highscoresArchiveKey = (postId: string): string =>
  `highscores:archive:${postId}`;

export const highscoresRotationLockKey = (): string =>
  `highscores:rotationLock`;
```

- `highscoresDailyKey` / `highscoresPermanentKey`: sorted sets, member = username, score = kill count.
- `highscoresLivePostKey`: a single string, the postId of the currently-live "Today's Highscores" post.
- `highscoresArchiveKey(postId)`: JSON blob written once at rotation time — `{ periodNumber: number; endedAt: number; top: HighscoreEntry[] }` — the frozen record an old post renders forever after.
- `highscoresRotationLockKey`: short-TTL (60s) NX lock so a cron fire and a manual "force rotate" can't double-rotate if they overlap.

## New route: `src/server/routes/highscores.ts`

`GET /api/highscores/board` — no request body; entirely driven by the requesting post's own server-side `context.postId` / `context.postData`:

- `context.postData?.kind === 'highscoresArchive'` → read `highscoresArchiveKey(postId)`, return the frozen snapshot with `status: 'archived'`.
- `context.postData?.kind === 'highscoresLive'` → compute `currentPeriod = highscorePeriodNumber()`, read top 10 from `highscoresDailyKey(currentPeriod)` and top 10 from `highscoresPermanentKey()`, return both with `status: 'live'`, plus the signed-in viewer's own daily/permanent kills+rank (via `zScore`/`zRank`, `undefined` if never scored or signed out) and `periodEndsAt` (from `highscorePeriodEndsAt`) so the client can show a countdown.
- Neither → `404`. This is the common case (every normal gameplay post) — `splash.ts` treats a 404 here as "not a highscores post, render the usual splash."

Response types live in `src/shared/highscoresApi.ts`, following `runsApi.ts`'s convention: plain types plus a hand-written type guard (`isHighscoreBoardResponse`) for the client to narrow the untyped `fetch` response without an `as` cast:

```ts
export type HighscoreEntry = { username: string; kills: number };

export type HighscoreBoardResponse =
  | {
      status: 'live';
      periodNumber: number;
      periodEndsAt: number;
      daily: HighscoreEntry[];
      permanent: HighscoreEntry[];
      yourDailyKills: number | undefined;
      yourDailyRank: number | undefined;
      yourPermanentKills: number | undefined;
      yourPermanentRank: number | undefined;
    }
  | {
      status: 'archived';
      periodNumber: number;
      endedAt: number;
      top: HighscoreEntry[];
    };
```

## Rotation: `POST /internal/scheduler/rotate-highscores`

New route (small enough to live in `highscores.ts` alongside the board endpoint). Registered in `devvit.json`:

```json
"scheduler": {
  "tasks": {
    "rotate-highscores": {
      "endpoint": "/internal/scheduler/rotate-highscores",
      "cron": "0 14 * * *"
    }
  }
}
```

Handler:

1. Acquire `highscoresRotationLockKey()` via `redis.set(key, '1', { nx: true, expiration: <60s from now> })`; if not acquired, return success immediately (another rotation is already in flight — cron overlapping a manual force-rotate).
2. Read `oldPostId = await redis.get(highscoresLivePostKey())`.
3. `endedPeriod = highscorePeriodNumber(Date.now()) - 1` (the period that just closed).
4. `top = await redis.zRange(highscoresDailyKey(endedPeriod), 0, 9, { by: 'rank', reverse: true })` → mapped to `HighscoreEntry[]`.
5. If `oldPostId` exists and `isT3(oldPostId)` (from `@devvit/shared-types` — `redis.get` returns a plain `string`, and `AGENTS.md` forbids `as` casts, so the branded `T3` post-id type is narrowed via this guard rather than cast; an unexpected non-`t3_` value is treated the same as "no old post" and logged):
   - `redis.set(highscoresArchiveKey(oldPostId), JSON.stringify({ periodNumber: endedPeriod, endedAt: Date.now(), top }))`.
   - `await (await reddit.getPostById(oldPostId)).setPostData({ kind: 'highscoresArchive' })`, wrapped in try/catch (the post may have been removed by a mod — log and continue, never block creating the new post on this).
6. Create the new live post: `reddit.submitCustomPost({ title: "Today's Highscores", postData: { kind: 'highscoresLive' } })`.
7. `redis.set(highscoresLivePostKey(), newPost.id)`.
8. Release the lock (`redis.del`) — or just let its TTL expire; deleting is cheap and avoids a stale lock lingering for the rest of its TTL window.

If `oldPostId` doesn't exist (very first rotation, or bootstrap somehow didn't run), step 5 is skipped entirely — the job just creates the first live post.

## Bootstrap

`triggers.ts`'s `on-app-install` handler, which already calls `createPost()` for the main post, also creates the initial highscores post the same way step 6 above does, and sets `highscoresLivePostKey()` — so a board exists from install rather than waiting up to 24h for the first cron fire.

## Manual rotation (moderator utility)

A `"Force-rotate highscores"` menu item, mirroring the existing `"Reseed built-in levels"` dev utility (`menu.ts`) — calls the same rotation handler on demand, for testing the daily cycle without waiting for the cron. Added to `devvit.json`'s `menu.items` per `AGENTS.md`'s rule that every new menu-item endpoint gets a matching devvit.json entry.

## Client: `splash.ts` / `splash.html`

`context.postData` (from `@devvit/web/client`, already available with no extra request) is read once at startup:

- `undefined` (normal gameplay post) → existing Play/Build/Browse card, unchanged.
- `{ kind: 'highscoresLive' | 'highscoresArchive' }` → fetch `/api/highscores/board` and render a leaderboard view instead: two tabs (Today / All-Time) for the live case, a single frozen list plus "Final standings" label for the archive case. Built as plain DOM (matching the existing vanilla-TS `ui/domUtils.ts` style already used by `RunResultOverlay.ts` etc.) — no Phaser, keeping the inline view fast per `AGENTS.md`.

No new HTML entrypoint or `devvit.json` `post.entrypoints` entry — every post's inline view is already the single shared `splash.html`/`default` entrypoint; the branch happens entirely on `postData`.

## Testing

Unit tests (`src/server/tests/`, matching the existing `regressions.test.ts` pattern — no headless/browser playtesting):

- `highscorePeriodNumber`/`highscorePeriodEndsAt`: boundary correctness just before/after 14:00 UTC, and that both functions agree on the same anchor.
- `/trap-kill`: self-kill does **not** increment either highscore sorted set but still increments the existing per-level counters unchanged; a normal (non-self) kill increments both new sorted sets exactly once.
- `/api/highscores/board`: returns 404 with no `postData`; returns the live shape for `highscoresLive`; returns the frozen shape for `highscoresArchive`.
- Rotation handler: archives the outgoing period onto the old post, creates a new live post, updates the pointer; a second concurrent call (lock held) is a no-op; missing `oldPostId` (first-ever run) skips archiving without erroring.

## Out of scope

- Anti-collusion/anti-farming beyond the single self-kill guard.
- Per-subreddit multi-tenancy handling — Devvit Redis keyspaces are already isolated per app installation, so no subreddit id needs to be embedded in any key here (consistent with every existing key in `redisKeys.ts`).
- Retrofitting the self-kill guard onto the existing per-level `trapKillsKey`/`userContributionsKey` counters.
