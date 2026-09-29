# CURSED — Reddit Community Platformer

Build a polished Reddit-native game called **CURSED**.

CURSED is a fast, one-button community platformer where Redditors create short levels, speedrun them, and progressively make them harder by adding one obstacle or power-up after completing them.

The central mechanic:

**Every published version of a level must have been beaten by a real player.**

Players are simultaneously:

* speedrunners
* level creators
* level modifiers
* trap creators

The game must work extremely well on **both mobile and desktop**.

Use:

* Devvit Web
* TypeScript
* Phaser
* Devvit Redis
* Devvit authenticated Reddit identity
* Devvit Realtime where useful

---

# 1. CORE LOOP

The main loop is:

```text
PLAY LEVEL
↓
DIE / RETRY
↓
BEAT LEVEL
↓
GET CLEAR TIME + RANK
↓
OPTIONALLY CURSE THE LEVEL
↓
ADD EXACTLY ONE OBJECT
↓
BEAT THE MODIFIED LEVEL
↓
PUBLISH NEW VERSION
↓
OTHER PLAYERS PLAY YOUR VERSION
↓
YOUR TRAPS CAN KILL THEM
↓
COME BACK TO IMPROVE TIMES / SEE KILLS / ADD MORE CURSES
```

This loop is the product.

Do not bury it under progression systems or menus.

---

# 2. CONTROL PHILOSOPHY

The game needs the simplicity of a Reddit-native casual game.

Do NOT use:

* left/right buttons
* virtual joysticks
* directional reversal mechanics
* complex ability controls

The player **automatically runs forward at a constant base speed**.

The only core player input is:

```text
JUMP
```

Desktop:

* Space
* Up Arrow
* W
* Mouse click

Mobile:

* Tap anywhere in the gameplay area

The character always moves forward.

There is **no direction reversal mechanic**.

---

# 3. JUMP FEEL

Movement must feel responsive and forgiving.

Implement:

* jump buffering
* coyote time
* variable jump height based on press duration if it feels good
* forgiving collision boxes
* fast restart

Suggested starting values:

```text
Coyote time: ~100ms
Jump buffer: ~100–150ms
```

Tune these through gameplay testing.

The controls should be understandable within seconds.

---

# 4. MOBILE + DESKTOP

This is one game shared across both devices.

The same:

* physics
* level geometry
* speed
* obstacles
* timers
* leaderboards

must apply to everyone.

A mobile player and desktop player must be able to compete on the same leaderboard fairly.

## Mobile

Primary interaction:

```text
Tap = Jump
```

Do not display virtual directional controls.

Gameplay area should respond to large touch targets naturally.

## Desktop

```text
Space / W / Up Arrow / click = Jump
```

Do not make desktop users click tiny UI controls.

---

# 5. RESPONSIVE GAME WORLD

Do not create separate mobile and desktop levels.

Use a fixed logical game coordinate system.

Scale the renderer responsively.

The camera should show the player and enough upcoming level geometry to react.

Different aspect ratios may reveal slightly different peripheral space, but they must not alter:

* obstacle positions
* distances
* physics
* player speed
* timing

Do not design exclusively around portrait or exclusively around 16:9.

Support:

* phone portrait
* phone landscape
* tablet
* desktop

---

# 6. GAMEPLAY

The player automatically moves forward.

The player must avoid obstacles and reach the finish portal.

Typical level length:

```text
10–30 seconds
```

Levels should be short enough that dying makes the user immediately want another attempt.

Death restart should happen extremely quickly.

Target:

```text
Death
↓
brief animation
↓
restart within ~0.3–0.6 seconds
```

Do not show a modal after every death.

---

# 7. WIN CONDITION

Each level contains:

* spawn point
* terrain
* obstacles
* optional power-ups
* finish portal

Reaching the finish portal completes the run.

---

# 8. SPEEDRUN TIMER

The primary competitive mechanic is **fastest completion time**.

Timer starts when the run begins.

Timer stops when the player enters the finish portal.

Store time in milliseconds.

Example result:

```text
CLEAR!

12.482s

#7 on this version

Personal Best: 12.482s
World Record: 9.831s
```

Avoid arbitrary score systems.

Time should be the primary measure of performance.

---

# 9. VERSION-SPECIFIC LEADERBOARDS

Each level version gets its own leaderboard.

Example:

```text
THE MEAT GRINDER
Version 31

FASTEST TIMES

1. u/Alice      8.921
2. u/Bob        9.144
3. u/Charlie    9.771
...
```

Show Top 10 publicly.

Always show the current user's own rank below it even if they are outside Top 10.

Example:

```text
#184 u/currentuser — 14.782
```

Do not combine leaderboard times from different versions.

Adding an obstacle fundamentally changes the level.

---

# 10. PLAYER STATISTICS

Track:

```text
Total clears
Total deaths
Levels created
Curses published
Trap kills
Personal bests
World records held
Unique versions cleared
Longest version-clear streak
```

Do not overbuild player profiles for MVP.

---

# 11. BASE LEVEL DESIGNER

Users can create original levels.

The editor should be simple enough to use on a phone.

Objects:

## Terrain

* Ground
* Platform
* Moving platform

## Hazards

* Spike
* Saw
* Moving saw
* Falling block

## Level Objects

* Spawn
* Finish portal
* Checkpoint if needed

## Power-Ups

* Double Jump
* Shield
* Speed Boost
* Slow Time
* Dash

The object architecture must be extensible.

Use an ObjectRegistry / factory system rather than hardcoding everything into GameScene.

---

# 12. MOBILE-FRIENDLY LEVEL EDITOR

Do not build a desktop editor and shrink it.

Use a grid-based system.

Workflow:

```text
Choose object
↓
Tap/click grid location
↓
Object snaps into place
↓
Test
↓
Publish
```

Bottom toolbar on mobile.

Side/bottom toolbar on desktop.

Support:

* tap/click object to select
* move selected object
* delete selected object
* undo
* redo
* test
* publish

Dragging can exist on desktop but cannot be required.

All important editor functions must work through simple taps/clicks.

---

# 13. BASE LEVEL VERIFICATION

A level creator cannot publish an untested level.

Before initial publication:

```text
CREATE LEVEL
↓
TEST LEVEL
↓
BEAT LEVEL
↓
PUBLISH VERSION 1
```

If the creator cannot beat it, it cannot be published.

---

# 14. CURSE SYSTEM

After beating the CURRENT version of a level, show:

```text
LEVEL CLEARED
12.482s

CURSE THIS LEVEL?
```

If selected, allow the player to add exactly **ONE** object.

Categories:

```text
HAZARD
POWER-UP
PLATFORM
```

The player cannot:

* delete existing objects
* reposition existing objects
* modify other people's objects

They can only add one new contribution.

---

# 15. CURSE PLACEMENT FLOW

Keep this much simpler than the full level designer.

Example:

```text
CHOOSE YOUR CURSE

SPIKE
SAW
FALLING BLOCK
POWER-UP
PLATFORM
```

Player selects one.

Valid grid locations become visible.

Player taps/clicks a valid position.

Then:

```text
PROVE IT'S POSSIBLE
```

Player must beat the new version.

---

# 16. VERIFICATION RULE

The most important rule:

> A new level version cannot be published unless the player who created the modification personally completes it.

Flow:

```text
Beat Version 17
↓
Add Saw
↓
Play Version 17 + Saw
↓
Beat it
↓
Publish Version 18
```

If they fail:

```text
FAILED VERIFICATION

RETRY
MOVE OBJECT
REMOVE OBJECT
CANCEL
```

They can retry as many times as they want.

Nothing becomes public until verification succeeds.

---

# 17. LEVEL VERSIONS

Published versions are immutable.

Example:

```text
Version 1
Created by u/Alice

Version 2
+ Spike by u/Bob

Version 3
+ Shield by u/Charlie

Version 4
+ Saw by u/Dave
```

Never modify Version 4.

Create Version 5.

Suggested schema:

```ts
interface LevelVersion {
  levelId: string;
  version: number;
  parentVersion: number | null;
  objects: LevelObject[];
  contributorUsername: string;
  addedObjectId?: string;
  verificationTimeMs: number;
  createdAt: number;
}
```

---

# 18. SIMULTANEOUS EDITS

Multiple players may beat the same level version simultaneously.

Example:

```text
Current version = 127

Player A beats 127.
Player B beats 127.

A adds a Saw.
B adds a Spike.
```

Player A publishes first:

```text
127 → 128
```

Player B must NOT overwrite it.

When B attempts publication, server checks:

```ts
submittedParentVersion === currentVersion
```

If false:

```text
THE LEVEL CHANGED

Someone cursed it while you were building.

Your Spike has been preserved.

Beat the newest version with your Spike to publish it.
```

Then:

```text
Version 128
+
Player B's proposed Spike
```

Player B must verify this combined configuration.

If successful:

```text
128 → 129
```

Use atomic server-side Redis operations to guarantee only one player can claim each new version.

Never trust the client for version numbering.

---

# 19. SERVER AUTHORITY

The server must control competitive state.

Do not trust the client to:

* choose Reddit identity
* assign leaderboard rank
* publish arbitrary versions
* increment kills
* increment statistics
* overwrite levels
* claim successful verification without validation
* assign version numbers

Use authenticated Reddit identity.

---

# 20. LEVEL IMPOSSIBILITY PROTECTION

Verification is the primary protection.

Also enforce placement rules.

Do not permit:

* hazards overlapping spawn
* hazards directly overlapping finish
* inaccessible finish portal
* objects outside level boundaries
* duplicate objects occupying exactly the same location
* invalid solid overlaps
* enormous object spam
* objects inserted inside the player spawn area

The candidate configuration used for verification must be exactly the configuration published.

Generate a server-side candidate/version token or hash.

Do not let the player verify one configuration and publish another.

---

# 21. POWER-UPS

All power-ups activate automatically.

There are **NO additional power-up buttons**.

This is important.

## Double Jump

On pickup:

```text
Player gains one additional mid-air jump.
```

Use jump input normally.

## Shield

Automatically absorbs the next fatal obstacle hit.

Then disappears.

## Speed Boost

Automatically increases forward speed temporarily.

Because it changes speedrun routing, its position is deterministic.

## Slow Time

Automatically slows moving hazards temporarily.

Do NOT slow the actual run timer.

## Dash

Do NOT add a Dash button.

Instead implement Dash as an automatic effect when collected.

For example:

```text
Pickup → immediate short forward burst.
```

All power-ups are deterministic.

No random power-up spawning.

---

# 22. POWER-UPS AS COMMUNITY CONTRIBUTIONS

Power-ups may be added during the curse process.

This creates interesting counterplay.

Example:

```text
Version 14
u/Alice adds a difficult Saw.

Version 15
u/Bob adds a Speed Boost before it.

Version 16
u/Charlie adds another Spike.
```

Community changes can make levels:

* harder
* faster
* stranger
* more technical

Not every contribution needs to make the level harder.

---

# 23. TRAP OWNERSHIP

Every added object needs attribution.

Example:

```ts
interface LevelObject {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  addedBy: string;
  addedInVersion: number;
}
```

When a hazard kills someone:

```text
YOU DIED

Killed by
u/Max's Saw

This trap has 84 kills.
```

Increment:

```text
trap kills
creator total trap kills
```

This is a major social mechanic.

---

# 24. ORIGINAL CREATOR + CONTRIBUTORS

Keep the original creator visible.

Example:

```text
THE MEAT GRINDER

Created by u/Alice

Version 37
36 community additions

14,271 attempts
892 clears
6.2% completion rate
```

Then:

```text
TOP CURSERS

u/Bob        4,281 kills
u/Charlie    2,944 kills
u/Dave       1,822 kills
```

Original creator owns the base level.

Contributors own the objects they added.

---

# 25. DIFFICULTY

Automatically calculate difficulty from completion rate.

Example:

```text
>50%     EASY
25–50%   NORMAL
10–25%   HARD
3–10%    CURSED
<3%      NIGHTMARE
```

This should update as more players attempt the level.

---

# 26. LEVEL DISCOVERY

Main screen:

```text
CURSED

[ PLAY ]

TRENDING
DEADLIEST
SPEEDRUN
NEW
CREATE
```

Cards:

```text
THE MEAT GRINDER
by u/Alice

Version 37
Completion: 6.2%
Attempts: 14.2K
Record: 8.921s

[ PLAY ]
```

Keep discovery simple initially.

---

# 27. TRENDING

MVP trending formula can consider:

```text
recent unique players
repeat attempts
number of mutations
recent clears
```

Do not build a complicated recommendation algorithm yet.

---

# 28. CLEAR STREAKS

Track how many consecutive unique level versions a user has successfully completed.

Do NOT reset a streak every time they die.

Attempts are expected.

Example:

```text
CURRENT SURVIVAL STREAK: 14 VERSIONS
```

A streak measures progression through different published versions, not flawless runs.

---

# 29. REALTIME EVENTS

Use realtime where helpful for:

```text
New version published
New world record
New community addition
```

If a player is currently running Version 37 and Version 38 publishes:

Do NOT interrupt their run.

Allow them to finish Version 37.

Afterward:

```text
VERSION 38 IS LIVE

u/Someone added a Saw.

[ PLAY LATEST ]
```

---

# 30. FAST RETRIES

The experience must encourage:

```text
one more try
```

Do not reload the entire app after death.

Reuse the scene/state.

Restart the player immediately.

Avoid network calls during the core death/restart loop.

---

# 31. VISUAL DIRECTION

The game should feel:

* playful
* slightly evil
* energetic
* polished
* funny
* Reddit-native

Avoid generic corporate UI.

Use simple stylized graphics rather than realistic assets.

Deaths should feel entertaining.

Examples:

* squish
* pop
* explosion
* exaggerated knockback

Keep effects lightweight enough for phones.

---

# 32. PLAYER CHARACTER

Use a recognizable, simple mascot-like character rather than a square.

Requirements:

* readable at small sizes
* clear jump animation
* funny death animation
* easy to reskin later

Do not spend excessive time on art before gameplay works.

---

# 33. PERFORMANCE

Optimize for ordinary phones.

Priorities:

* fast initial load
* sprite atlases
* minimal asset weight
* limited particle counts
* object pooling where useful
* limited active physics objects
* minimal DOM interaction while Phaser gameplay is running

Target smooth 60 FPS when practical.

Gameplay quality matters more than visual effects.

---

# 34. REDDIT INLINE POST

The inline Reddit post should not try to contain the entire game.

Use it as the entry point.

Example:

```text
CURSED

The Meat Grinder
Version 37

World Record: 8.921s
Completion: 6.2%

[ PLAY ]
```

PLAY should launch the proper game view.

Keep the Reddit feed experience lightweight.

---

# 35. DATA MODEL

Use Redis.

Possible structure:

```text
level:{id}:meta
level:{id}:currentVersion

level:{id}:version:{n}

level:{id}:version:{n}:leaderboard

user:{redditId}:stats

user:{redditId}:createdLevels
user:{redditId}:contributions

trap:{objectId}:kills
```

Use sorted sets where appropriate for leaderboard times.

Lower time = better.

---

# 36. SECURITY / VALIDATION

At minimum validate:

* authenticated user
* current version
* legal object type
* legal object coordinates
* object count
* placement rules
* candidate version identity
* verification relationship
* leaderboard submission structure

Do not spend weeks building anti-cheat before testing the core game.

Build reasonable server authority first.

---

# 37. CODE ARCHITECTURE

Suggested structure:

```text
src/
  client/
    game/
      scenes/
        GameScene.ts
        EditorScene.ts
        VerificationScene.ts

      entities/
        Player.ts

      objects/
        ObjectRegistry.ts
        Platform.ts
        Spike.ts
        Saw.ts
        FallingBlock.ts
        PowerUp.ts

      systems/
        LevelLoader.ts
        TimerSystem.ts
        CollisionSystem.ts
        PowerUpSystem.ts
        DeathSystem.ts
        InputSystem.ts

      editor/
        EditorController.ts
        GridSystem.ts

    ui/

  server/
    routes/
      levels.ts
      runs.ts
      publish.ts
      leaderboard.ts
      users.ts

    services/
      LevelService.ts
      VersionService.ts
      VerificationService.ts
      LeaderboardService.ts
      StatsService.ts

  shared/
    types.ts
    constants.ts
```

Avoid giant files.

Keep gameplay logic separate from Reddit persistence logic.

---

# 38. DEVELOPMENT ORDER

Do not build everything simultaneously.

## Phase 1 — Movement

Build:

* auto-run
* jump
* collisions
* death
* instant restart
* finish portal

Make this feel excellent first.

## Phase 2 — Timing

Add:

* timer
* completion
* personal best
* basic leaderboard

## Phase 3 — Level Format

Build reusable serialized levels.

Load levels dynamically.

## Phase 4 — Editor

Build simple grid editor.

Allow users to create, test and publish Version 1.

## Phase 5 — Curse Loop

Implement:

```text
Beat
→ add one object
→ verify
→ publish next version
```

## Phase 6 — Version Concurrency

Implement atomic compare-and-publish.

Handle stale edits properly.

## Phase 7 — Attribution

Add:

* trap owner
* trap kills
* contributor stats

## Phase 8 — Power-Ups

Add deterministic auto-activation power-ups.

## Phase 9 — Discovery

Add:

* trending
* deadly
* new
* create

## Phase 10 — Polish

Improve:

* animation
* sound
* mobile UX
* responsive layouts
* performance

---

# 39. MVP OBJECT SET

Do not create dozens of objects initially.

Start with:

```text
Ground
Platform

Spike
Saw
Moving Saw

Double Jump
Shield
Speed Boost
Slow Time
Auto Dash

Spawn
Finish
```

Only add more after the core loop works.

---

# 40. CORE PRODUCT RULES

These are non-negotiable.

1. Player automatically runs forward.

2. Jump is the only normal gameplay input.

3. There is no player-controlled direction reversal.

4. All power-ups activate automatically.

5. Every public level version has been successfully completed.

6. Beating the current version allows one proposed addition.

7. One curse = exactly one added object.

8. Existing contributions cannot be deleted through the curse flow.

9. Published versions are immutable.

10. Concurrent edits cannot overwrite each other.

11. Every leaderboard belongs to a specific version.

12. Trap ownership is visible.

13. Mobile and desktop use identical gameplay rules.

14. No virtual directional controls.

15. Levels should be short.

16. Death-to-retry must be extremely fast.

---

# 41. FIRST COMPLETE VERTICAL SLICE

Do not expand scope until this works:

```text
Redditor opens game
↓
Taps PLAY
↓
Character auto-runs
↓
Player taps/presses to jump
↓
Player dies on Saw
↓
Instant retry
↓
Player beats level
↓
Gets time + leaderboard rank
↓
Chooses CURSE
↓
Selects Spike
↓
Places Spike
↓
Must replay modified level
↓
Successfully beats it
↓
Publishes new version
↓
Reloads level
↓
Spike is now permanently present
↓
Their Reddit username owns that Spike
↓
Another player dies to it
↓
Trap kill count increases
```

If this loop is fun, continue building the game.

If this loop is not fun, improve it before adding more systems.
