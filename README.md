# SKETCHY

A one-button community platformer that lives in your subreddit. Redditors
build short levels, beat them, and then **curse** them: each curse adds one
new trap. Every version of every level has been beaten by a real player, so
no trap is ever impossible. They just keep getting worse.

## How to play

- Your doodle runs forward on its own. **Tap anywhere** (or press
  **Space**) to jump.
- Hit a trap and you're back at the start instantly. Try again.
- Reach the pencil sharpener at the end to clear the level.

## The curse loop

1. **Clear a level.**
2. **Leave your curse.** Place one trap anywhere you like: a stapler, a
   saw, a bat, a ghost, spikes, a mine or a mace.
3. **Prove it.** Beat the level with your trap in it. Only then does your
   version go live.
4. **Watch it work.** Your trap is credited with every player it catches,
   and the best cursers make the **Top Cursers** board.

Next Level unlocks once you've left your curse. Cursing is the game.

## Also in the game

- **Build:** make your own level with the tile editor, beat it once, and
  publish it. It gets its own post in the subreddit.
- **Browse:** find levels by Trending, Deadliest, Speedrun or New.
- **Level of the Day:** a new featured level is posted every day.
- **Power-ups:** Shield, Speed Boost, Wings (an extra mid-air jump) and
  Stopwatch.
- **First Blood:** a gentle starter level for first-time players, which
  can't be cursed.

Each player can publish up to 10 levels and place up to 30 curses a day.

## For moderators

After installing, open the subreddit menu:

- **Create a SKETCHY post:** posts the hub (play, build, browse). Pin it.
- **SKETCHY: post Level of the Day now:** features the top trending level
  immediately. This also runs automatically every day at 16:00 UTC.
- **SKETCHY: reseed built-in levels (dev)** and **reset built-in level
  stats (dev):** pre-launch tools. They sync the built-in levels with the
  app's source and zero their play counts after testing. Players' curses
  are kept.

The app never sends private messages to players.

## Credits

- Scribble art from Kenney's [Scribble Platformer](https://kenney.nl) pack
  (CC0).
- Effects from the VFX Free Pack and Super Pixel Effects.
- Built with [Devvit](https://developers.reddit.com/),
  [Phaser](https://phaser.io/), [Hono](https://hono.dev/) and
  [Vite](https://vite.dev/).

## Development

Requires Node 24 and a Reddit developer account (`npm run login`).

| Command                    | What it does                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Live playtest on r/sketchy_game_dev                                                                |
| `npm run type-check`       | TypeScript                                                                                         |
| `npm run lint`             | ESLint                                                                                             |
| `npm run test:unit`        | Server and shared unit tests                                                                       |
| `npm run check:production` | Types, lint, tests, build and bundle-size budgets                                                  |
| `npm run test:browser`     | Playwright checks of the built client (run after a build)                                          |
| `npm run test:playtest`    | Builds, then plays every scenario in `tools/playtest/scenarios` (deaths, power-ups, finish, spawn) |
| `npm run deploy`           | `check:production`, then upload a new version                                                      |
| `npm run launch`           | Deploy, then submit for review                                                                     |

See [docs/production-performance.md](docs/production-performance.md) for
asset rules and performance budgets.
