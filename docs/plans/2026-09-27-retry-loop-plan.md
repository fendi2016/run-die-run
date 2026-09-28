# CURSED — Retry Loop Pass (2026-09-27)

Goal: make dying cheap and progress visible, the way hard one-button games
(Geometry Dash, Super Meat Boy) keep people retrying. Scope agreed with the
user: items 1–3 of the design review, plus removing Shards and the slide.
Out of scope (need decisions first): sealing/forking over-cursed levels,
a tutorial level, practice mode.

| # | Work | Owner | Files |
|---|---|---|---|
| A | Remove Shards (currency) end to end — server awarding, routes, API types, clear screen, stats/menu chips, tests | Sonnet (worktree) | server `currency.ts` `runs.ts` `userStats.ts` `redisKeys.ts` `index.ts`; shared `currencyApi.ts` `runsApi.ts` `userStatsApi.ts` `constants.ts`; client `RunResultOverlay.ts` `StatsOverlay.ts` `GameMenu.ts` `game.html` `game.css`; tests, `tools/stage-one-regressions.mjs` |
| B | Death markers, server side — record death x per level version, serve aggregated buckets | Sonnet (worktree) | new `server/routes/deaths.ts`, new `shared/deathsApi.ts`, `redisKeys.ts`, `index.ts`, tests |
| C | Run HUD component — attempt counter + progress bar with best-distance mark (per viewer, localStorage) | Sonnet (worktree) | new `client/ui/RunHud.ts`, `game.html`, `game.css` |
| D | Remove the slide — double-tap, hitbox shrink, anims, VFX, SFX, tips. Also removes the 180ms wait before every ground jump | Opus | `Player.ts`, `constants.ts`, `Juice.ts`, `Preloader.ts`, `Sfx.ts`, `DeathPanel.ts`, assets |
| E | Instant retry — auto-respawn after the death effect, any jump input skips it; attribution becomes a non-blocking toast; death Share moves to the pause menu; curse Prove It's Back uses the top-left back button | Opus | `GameScene.ts`, `DeathPanel.ts`, `game.html` |
| F | Wire C + B into GameScene: attempt count, live progress, best mark, faint skull markers from other players' deaths | Opus | `GameScene.ts` |
| G | Merge branches, `npm run check:production`, browser playtest, commit | Opus | — |

Notes
- Death markers are scoped to the level *version* — a fresh curse starts
  with a clean slate, which is honest (old deaths were against a different
  layout).
- Preview runs (editor Test, curse Prove It) never report death positions
  and never count toward attempts/best.
- Risk: player-published levels verified *with* the slide may have a
  head-height hazard that is now unavoidable. Seed level Meat Grinder is
  jump-only by design.
