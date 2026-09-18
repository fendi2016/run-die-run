# CURSED — Phased Build Plan

**Spec:** [`build for run die run.md`](../../build%20for%20run%20die%20run.md)

This is a phased architecture/sequencing plan, not a bite-sized task-by-task
implementation plan. It expands the spec's own section 38 ("Development
Order") into concrete engineering decisions tied to this repo's actual stack
(Devvit Web, Hono, Phaser, Devvit Redis) so each phase has a clear scope, exit
criteria, and non-negotiable rules it's responsible for enforcing.

Current repo state at time of writing: stock Devvit Web + Phaser + Hono
template (`Boot/Preloader/MainMenu/Game/GameOver` scenes), no game logic yet.

## Phase 0 — Architecture scaffolding (no gameplay yet)

Lock in decisions that every later phase depends on, so they don't get
relitigated mid-build:

- **Folder structure**: create the `client/game/{scenes,entities,objects,systems,editor}`,
  `server/{routes,services}`, `shared/` layout from spec section 37. Replace
  the boilerplate scenes.
- **Shared contracts** (`src/shared/types.ts`, `constants.ts`): `LevelObject`,
  `LevelVersion`, `RunResult` shapes from spec sections 17/23, plus the
  logical coordinate system's fixed resolution/units. These are the
  interface every client and server task will consume, so they need to exist
  before Phase 1.
- **Coordinate & scaling strategy** (spec section 5): fixed logical game
  units, Phaser scale mode that letterboxes/extends rather than reflowing
  geometry. This decision is what makes rule 13 ("mobile and desktop use
  identical gameplay rules") true by construction rather than by testing.
- **Input abstraction**: a single `InputSystem` that normalizes keyboard
  (Space/Up/W), mouse click, and touch tap into one `jump` event. This is
  what makes rules 2/3/14 (jump-only, no reversal, no virtual controls)
  structural instead of enforced ad hoc per platform.
- **Redis key namespace** (spec section 35): finalize key names now
  (`level:{id}:meta`, `:currentVersion`, `:version:{n}`,
  `:version:{n}:leaderboard`, `user:{id}:stats`, `trap:{objectId}:kills`) so
  later services don't drift.

**Exit criteria:** empty scenes wired up, shared types compile, app boots in
`devvit playtest` on both a desktop and mobile viewport with nothing but a
placeholder rectangle you can move with the unified input.

## Phase 1 — Movement feel (client-only, no server calls)

Matches spec's own Phase 1. Build auto-run, jump, coyote time (~100ms), jump
buffer (~100–150ms), collision, death, instant restart, and the finish
portal — all against one hardcoded test level, entirely client-side.

- Enforce rule 30 here, not later: no network calls anywhere in the
  death→restart path. Reusing the scene/state instead of reloading is an
  architectural constraint of `GameScene`, not a polish pass.
- This phase is explicitly a feel-tuning loop: playtest repeatedly, adjust
  the suggested starting values, don't move on until jump/death/restart
  feels good on both a touch device and a keyboard.

**Exit criteria:** can play the one hardcoded level start-to-finish on
mobile and desktop with identical timing/physics, death-to-restart under
~0.6s.

## Phase 2 — Timing + first server round-trip

Add the speedrun timer (start on run begin, stop on portal entry, store ms),
personal best, and a bare leaderboard — but only for the one hardcoded test
level, to prove the server path before generalizing it.

- First real `server/routes` + `server/services` code: a `runs.ts` route and
  `LeaderboardService`/`StatsService` backed by a Redis sorted set (lower
  time = better).
- Server authority principle starts here (spec section 19): the client
  submits a time, the server is the one that assigns rank — never trust a
  client-computed rank.

**Exit criteria:** clearing the test level writes to Redis, reloading shows
an updated personal best and Top 10, and rank is computed server-side.

## Phase 3 — Generalized level format

Build the serialized `LevelVersion`/`LevelObject` format for real and make
`LevelLoader` load *any* level from that format instead of the Phase 1
hardcoded one. Stand up `LevelService`/`VersionService` and the
`level:{id}:*` Redis keys for real.

- This is also where the `ObjectRegistry`/factory pattern (spec section 11)
  needs to exist — every object type from here on (Spike, Saw, FallingBlock,
  PowerUp...) gets added to the registry rather than hardcoded into
  `GameScene`.
- Leaderboards become version-scoped for real here (rule 11) — the Phase 2
  leaderboard gets re-keyed under `level:{id}:version:{n}:leaderboard`.

**Exit criteria:** two or three hand-authored test levels (as data, not
code) load and play correctly through the same `GameScene`.

## Phase 4 — Base level editor + base verification

Grid-based mobile-first editor (spec section 12): choose object → tap grid
cell → snap → test → publish. Support select/move/delete/undo/redo on top of
tap-only interaction (dragging optional, never required, per section 12).

- Wire in base verification (spec section 13): a level can't publish
  Version 1 until the creator personally beats it in the actual `GameScene`
  (not a simulated check) — this is rule 5 for the base-creation path.
- Placement-rule validation (spec section 20) belongs here too, server-side:
  no hazards on spawn/finish, finish must be reachable-by-construction
  rules, no out-of-bounds, no duplicate-position objects. Client can
  pre-filter for UX, but the server is the enforcer.

**Exit criteria:** a player can build a level on a phone screen, test it,
fail if they can't beat it, and successfully publish Version 1, which then
appears through the Phase 3 loader for other users.

## Phase 5 — Curse loop (the core product mechanic)

This is the loop the whole game is named for, so treat it as its own
hardening phase, not a variant of Phase 4's editor.

- Post-clear prompt ("CURSE THIS LEVEL?"), the restricted curse-placement UI
  (spec section 15 — pick one category, valid-cell highlighting, place,
  "PROVE IT'S POSSIBLE"), and the verification replay against the *exact*
  candidate configuration.
- Enforce rules 6–8 structurally: the curse editor is a deliberately smaller
  component than the Phase 4 editor — it should be incapable of deleting or
  moving existing objects, not just told not to.
- Server-side candidate/version token or hash (spec section 20) generated at
  "propose" time and re-checked at publish time, so what was verified is
  provably what gets published.
- Failure path (spec section 16): retry / move object / remove object /
  cancel, unlimited retries, nothing public until verification succeeds.

**Exit criteria:** the full section-41 vertical slice works end-to-end —
beat a level, curse it with a Spike, verify, publish, reload, see the Spike
permanently present with your username attached. This is the "if this isn't
fun, stop and fix it before adding more systems" gate from the spec — treat
it as a real checkpoint, not a formality.

## Phase 6 — Version concurrency

Implement the compare-and-publish flow from spec section 18: atomic Redis
check that `submittedParentVersion === currentVersion`, and the "THE LEVEL
CHANGED... your Spike has been preserved, beat the newest version with your
Spike" re-verification path when a race is detected.

- Needs an actual concurrency test, not just code review: simulate two
  publishes against the same parent version and confirm only one wins
  atomically (Redis `WATCH`/transaction or equivalent optimistic-lock
  pattern) and the loser is prompted to re-verify against the new base
  rather than silently dropped or silently overwriting.

**Exit criteria:** two concurrent curse attempts against the same version
never both succeed, and the second one is offered a clean re-verify path
with their object preserved.

## Phase 7 — Attribution

Add `addedBy`/`addedInVersion` tracking end-to-end, the "Killed by u/X's
Saw — this trap has N kills" death screen, and contributor/creator stats
aggregation (spec sections 23–24).

- Mostly additive: extend `LevelObject` usage already established in
  Phase 3/5, add `trap:{objectId}:kills` increments in the death/collision
  path, and surface creator + top-cursers panels.

**Exit criteria:** dying to a community-added trap correctly attributes and
increments both the trap's kill count and the creator's total.

## Phase 8 — Power-ups

Implement the MVP set (Double Jump, Shield, Speed Boost, Slow Time, Auto
Dash) as auto-activating pickups only — no buttons, ever (spec section 21).
Confirm they're placeable through both the base editor (Phase 4) and the
curse flow (Phase 5) as community contributions (spec section 22).

- Slow Time must scale hazard motion without touching the run timer — worth
  a dedicated check since it's the one power-up most likely to accidentally
  leak into timing code.

**Exit criteria:** each power-up works identically whether picked up on a
creator's original level or added later via curse, and none require any
input beyond the existing jump.

## Phase 9 — Discovery

Trending/Deadliest/Speedrun/New/Create surfaces (spec sections 26–27) plus
the Reddit inline post entry point (spec section 34) and difficulty
labeling from completion rate (spec section 25).

- Keep the trending formula intentionally simple per the spec — recent
  unique players, repeat attempts, mutation count, recent clears — not a
  recommender system.
- Realtime (spec section 29) lands here too: publish/world-record/
  new-addition events via Devvit Realtime, with the "don't interrupt an
  in-progress run, prompt after" rule for version updates.

**Exit criteria:** the subreddit feed post launches into the real game, and
the home screen lists real levels by each sort.

## Phase 10 — Polish

Animation, death juice (squish/pop/explosion per spec section 31), sound,
mobile UX pass, responsive layout edge cases (portrait/landscape/tablet),
and performance (sprite atlases, object pooling, particle limits) — done
last and only after the loop is proven fun, per the spec's own instruction.

---

## Notes on sequencing

- **Server-authority and validation (spec sections 19–20, 36)** aren't a
  separate phase — they're threaded through Phases 2 (rank), 4 (placement
  rules), 5 (verification/candidate hash), and 6 (concurrency) as each
  capability is introduced, rather than bolted on afterward.
- **Rule 15 ("levels should be short," 10–30s)** isn't code — it's a
  content constraint. Worth enforcing softly in the Phase 4 editor (e.g. a
  soft grid-width cap) rather than building a hard validator for it.
- The **section 41 vertical slice is the real go/no-go gate**, and it
  completes at the end of Phase 5, not Phase 10. Everything past Phase 5 is
  only worth building if that slice is actually fun in playtesting.
- Every phase after Phase 0 should end with a real `devvit playtest` session
  on both a phone-sized viewport and desktop before moving on — that's the
  cheapest way to catch a rule-13 violation (mobile/desktop divergence)
  before it's buried under later phases.
