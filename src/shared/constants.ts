// Fixed logical game resolution. Every gameplay position, distance, and speed is
// authored in these units so mobile and desktop players see the same level
// regardless of device aspect ratio (spec section 5).
export const LOGICAL_WIDTH = 960;
export const LOGICAL_HEIGHT = 540;

// Grid unit shared by level data and the (future) level editor, so placed
// objects always land on the same cell boundaries a level's data describes.
export const GRID_CELL_SIZE = 60;

// World-layout baseline shared by level authoring (server seed data) and
// gameplay (client fall-through-a-gap detection), so both agree on where
// "the ground" sits without either hardcoding the other's assumptions.
export const GROUND_TOP_Y = 480;
export const FALL_DEATH_Y = GROUND_TOP_Y + 400;

// The level loaded when no level is explicitly requested (spec section 38,
// Phase 3: one hardcoded default while there's no discovery UI yet).
export const DEFAULT_LEVEL_ID = 'meat-grinder';

// What a hub post (one with no postData) asks the server for: the current
// Level of the Day, or DEFAULT_LEVEL_ID until the first one is posted.
// Resolved server-side (DailyService.resolveLevelId). The '@' keeps it from
// ever colliding with a published level's slug, which is [a-z0-9-] only.
export const HUB_LEVEL_ID = '@today';

// The built-in easy course new players get after the tutorial (hub post)
// or when they're struggling on a community level. Locked against curses
// so it stays forgiving forever, and never featured as Level of the Day.
export const STARTER_LEVEL_ID = 'first-blood';
export const CURSE_LOCKED_LEVEL_IDS: ReadonlySet<string> = new Set([STARTER_LEVEL_ID]);
// Offer the starter to a player who has died this many times on one
// community level while their best distance is still under this fraction.
export const STRUGGLE_DEATHS = 8;
export const STRUGGLE_MAX_PROGRESS = 0.5;

// Editor grid bounds (spec section 12). A soft cap, not a hard "this is too
// long" validator — spec section 38's phase notes call for enforcing
// "levels should be short" (rule 15) softly via the editor's own grid size
// rather than a dedicated length validator. Row 0 is the ground surface;
// higher rows are elevated cells above it (see client GridSystem).
export const EDITOR_MAX_COLUMNS = 90;
export const EDITOR_MAX_ROWS = 6;
export const EDITOR_MAX_OBJECTS = 250;
export const EDITOR_SPAWN_BUFFER_CELLS = 2;

// The splash screen (plain HTML/CSS, a separate document from game.html)
// can't tell `requestExpandedMode` which Phaser scene to land on — it only
// takes a devvit.json entrypoint name, not a route. It writes one of these
// into localStorage (same origin as game.html) right before expanding, and
// MainMenu.create() reads/clears it to jump straight past itself instead of
// always landing on the menu, so "Play" on the splash means "play", not
// "open a menu that also has a Play button".
export const SPLASH_AUTOSTART_KEY = 'sketchy:splash-autostart';
export type SplashAutostart = 'game' | 'editor' | 'browse' | 'leaderboard' | 'stats';

// The placeholder "creator" of the hand-authored seed levels (spec section
// 38, Phase 3) — not a real Reddit account. Shared so the client's death
// attribution UI (spec section 23) can recognize it and skip showing a
// fake "Killed by u/sketchy_seed's Candle" attribution for these
// not-yet-community-created levels.
export const SEED_AUTHOR = 'sketchy_seed';

// The playtest subreddit from devvit.json's `dev.subreddit`. Debug-only
// affordances (the finish-line warp key) check this at runtime instead of
// a Vite DEV flag — `devvit playtest` ships a production build too, so a
// build-time flag would be off in the one place those tools are needed.
export const DEV_SUBREDDIT = 'sketchy_game_dev';

// Per-user daily caps on publishing levels (each one is a new post) and
// cursing, so one account can't flood the subreddit.
export const LEVEL_PUBLISHES_PER_DAY = 10;
export const CURSES_PER_DAY = 30;

// A level's thread gets one comment per this many curses, summing them up
// (a comment on every curse flooded busy threads).
export const CURSE_COMMENT_EVERY = 10;

// How many entries a leaderboard listing (per-level times, or the global
// Clear Streaks board) returns.
export const LEADERBOARD_TOP_N = 10;
