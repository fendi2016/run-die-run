# CURSED — Launch / Virality Plan (2026-09-23)

The core game loop is done. What's missing is *distribution*: today the whole
app lives inside one Reddit post, and nothing a player does ever produces a
new post, comment, or notification. This plan closes that, in priority order.

Devvit APIs this relies on (verified in `node_modules/@devvit`, 0.14.4):
- `reddit.submitCustomPost({ title, postData, textFallback })` — `postData`
  is ≤2KB JSON, readable as `context.postData` on BOTH client and server.
- `reddit.submitComment({ id: T3, text, runAs: 'APP' })`
- `reddit.sendPrivateMessage({ to, subject, text })`
- `devvit.json` `scheduler.tasks.<name> = { endpoint, cron }`
- client `showShareSheet({ post?, title?, text? })` — native share sheet on
  mobile, clipboard on desktop.

---

## 0. Launch blockers (security / cleanup) — do first

| Item | Change |
|---|---|
| Key `7` instantly clears any run (incl. **verification** runs → impossible levels publishable, Shards farmable) | Only honor it on the dev subreddit (`cursed_game_dev`). |
| Stock "Example form" menu item + form | Remove from `devvit.json`, `menu.ts`, `forms.ts`. |
| No publish/curse rate limits | Per-user daily caps: 5 level publishes, 20 curses (Redis counter w/ 1-day expiry). |
| Level titles go straight into a Reddit post title | Strip URLs / `u/` `r/` pings / markdown, collapse whitespace. |
| Install creates a post titled `cursed` | Proper hub post title + old-reddit text fallback. |

## 1. One post per level  ← the core viral mechanic

- `shared/postData.ts`: `CursedPostData = { levelId, daily? }` + guard.
- `server/core/post.ts`: `createLevelPost()` submits a custom post with
  `postData`, records `level:{id}:postId` (first post wins — the canonical
  one), returns the post. `createHubPost()` for install/menu.
- `POST /api/publish/publish` creates the level's post right after the
  Redis transaction commits (best-effort — a Reddit API hiccup never fails
  an already-committed publish). Response gains `postUrl`; the editor shows
  a toast and offers to open it.
- Client level resolution: `?level=` → `context.postData.levelId` →
  `DEFAULT_LEVEL_ID`.
- Splash + in-game menu show **that post's** level: title, version, clear
  rate, difficulty, run count, creator. `GET /api/discovery/stats/:id`
  grows those fields.
- Browse gains nothing new; it already lists every level.

## 2. Curses become comments

On a successful curse publish, the app comments on the level's post:
> 🩸 **u/foo** cursed this level → **v38**: added a **Saw** (and removed a platform). Can you still beat it?

Best-effort, after commit. This turns every curse into bump activity on the
post and a public rivalry thread.

## 3. Trap owners hear about their kills

In `POST /api/runs/trap-kill`, when a contributor's *cross-level* total
crosses a milestone (1, 10, 50, 100, 500, 1k, 5k, 10k…), send them one PM:
> Your traps in r/X have now killed **100** players. Top trap: your Saw on "Meat Grinder".

Milestones (not a daily digest) = exactly-once, no spam, no scheduler, and
it fires at the moment it's most exciting. Never for `SEED_AUTHOR`.

## 4. Daily level post

- `devvit.json` scheduler task `daily-level`, cron `0 16 * * *` (UTC).
- Picks the top **trending** level that hasn't been featured yet (hash
  `daily:featured`), falling back to least-recently-featured.
- Posts **"Cursed Level of the Day #N — {title} by u/{creator}"** with
  `postData = { levelId, daily: N }`.
- Mod menu item "Post Level of the Day now" runs the same code (for launch
  day, and if the cron ever misses).

## 5. Share buttons

- Death panel: **Share** → *"Killed by u/foo's Saw on 'Saw Hell' — 23 deaths
  and counting 💀"* via `showShareSheet` (links the current post).
- Clear panel: **Share** → *"I beat 'Saw Hell' v38 (6% clear rate) after 23
  deaths. Your turn."*
- GameScene tracks deaths-this-session per level for the copy.

## 6. First-10-seconds onboarding

- Tap-to-start reads **"Tap to Jump"** with a sub-line *"hold for higher"*.
- The first 3 deaths of a session show a one-line tip on the death panel
  ("Tip: hold to jump higher").
- Default-level difficulty tuning stays deferred (user's call, see HONK
  memory) — flagged, not changed.

---

## Deliberately NOT in this plan
- Time/rank/WR display (intentional cut).
- Posting comments *as the user* (`runAs: 'USER'`) — needs Reddit's review
  for user-actions; share sheet covers the need for launch. Good follow-up.
- Level-title profanity list — mods can remove posts; revisit if abused.
- Push notifications (`@devvit/notifications` is marked experimental).

## Order of commits
1. Launch blockers (§0)
2. Post per level + per-level splash (§1)
3. Curse comments + kill-milestone PMs (§2, §3)
4. Daily level (§4)
5. Share + onboarding (§5, §6)
