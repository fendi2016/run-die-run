import { GRID_CELL_SIZE } from '../../shared/constants';

// Gameplay tuning values (spec section 3). Client-only — the server never
// needs to know jump physics, only final validated positions/times.
// px/s, constant auto-run speed. The camera has no independent scroll
// value — GameScene re-centers scrollX on the player's world x every frame
// (see GameScene's update loop), so this single constant also *is* the
// level scroll speed. Raising it speeds up the run and the scroll together.
export const RUN_SPEED = 320;
export const GRAVITY_Y = 1800; // px/s^2
export const JUMP_VELOCITY = 620; // px/s, initial upward velocity on jump
export const JUMP_RELEASE_MULTIPLIER = 0.5; // cuts the jump short if released early
// A release can't cut the jump until this long after take-off, so even the
// quickest tap is a real jump — without it a phone tap (~60-100ms) hopped
// too low to clear a candle, the smallest hazard. Holding still goes higher.
export const MIN_JUMP_HOLD_MS = 180;
export const COYOTE_TIME_MS = 100;
export const JUMP_BUFFER_MS = 130;

export const PLAYER_SIZE = 80;
// The editor/curse spawn-marker icon reuses the player idle texture but
// must fit inside one grid tile (unlike the real player, which is allowed
// to overhang neighboring tiles while running) — otherwise it visually
// overlaps whatever's placed in the next column over.
export const SPAWN_ICON_SIZE = Math.min(PLAYER_SIZE, GRID_CELL_SIZE);

// Death respawns on its own after RESPAWN_DELAY_MS — long enough for the
// hazard's death effect to read — and any jump input after
// RESPAWN_SKIP_AFTER_MS skips the rest of the wait. The skip floor keeps a
// jump pressed a hair too late (the one that failed) from also restarting
// the run before the player even sees what hit them.
export const RESPAWN_DELAY_MS = 600;
export const RESPAWN_SKIP_AFTER_MS = 150;

// Finishing is a rarer, deliberate moment (not the tight death/retry loop),
// so this affords time to read the CLEAR! result — time, rank, PB, WR —
// after the leaderboard round-trip resolves, before auto-restarting.
export const FINISH_RESTART_DELAY_MS = 2500;

// The finish trigger's hitbox is grown to this height (LevelLoader) so a
// jump can't clear it and sail past the level's edge — a single jump peaks
// at JUMP_VELOCITY^2 / (2 * GRAVITY_Y) ≈ 107px above ground, and this leaves
// generous margin above that. The visible gate sprite itself is left
// untouched; only the overlap sensor is taller.
export const FINISH_TRIGGER_HEIGHT_PX = 320;

// How far from the left edge of the screen the player sits while running,
// so there's always more upcoming level geometry visible than trailing.
export const PLAYER_SCREEN_ANCHOR = 0.35;

// Power-up tuning (spec section 21). All auto-activate on pickup, all
// deterministic (no randomness), none add a new input.
export const SPEED_BOOST_MULTIPLIER = 1.6;
export const SPEED_BOOST_DURATION_MS = 1400;
// Amplitude/period of a Moving Saw's deterministic back-and-forth path.
export const MOVING_SAW_AMPLITUDE_PX = 90;
export const MOVING_SAW_PERIOD_MS = 900;
// A Moving Platform travels farther and slower than a Moving Saw — it
// needs to be rideable/predictable, not a fast-twitch hazard.
export const MOVING_PLATFORM_AMPLITUDE_PX = 160;
export const MOVING_PLATFORM_PERIOD_MS = 2200;
// A Bat sits still until it enters the camera's view, then locks onto the
// player's exact position at that instant and dashes straight at (and past,
// and beyond) it forever — never re-aiming. Faster than the player's own
// auto-run speed (RUN_SPEED) so it visibly closes the distance once
// triggered, but only launched once it's already on screen, leaving real
// reaction room instead of an unavoidable off-screen surprise.
export const BAT_DASH_SPEED_PX = 480;
// A Ghost drifts vertically instead of horizontally — a slow haunting float
// rather than a patrol — so it reads as a different kind of threat than the
// horizontal hazards above.
export const GHOST_AMPLITUDE_PX = 50;
export const GHOST_PERIOD_MS = 1600;

// The mossy-stone platform tileset's tiles are chunky blocks (~143x124
// source px), not the old thin 60x20 plank — every variant is forced to
// this one display size (width matches the grid cell) rather than each
// texture's own aspect ratio, so every platform tile shares one collision
// footprint regardless of which edge/center variant got picked.
export const PLATFORM_DISPLAY_HEIGHT_PX = 52;

// On-screen heights of the animated ghost/candle/bat spritesheets (aspect
// preserved). Each sheet's shared frame canvas includes room for the
// motion across its 8 frames (wing flaps, flame flicker, ghost sway), so
// these size the canvas, not just the figure — the ghost's is taller so
// its visible body stays the size of the old static art.
export const BAT_DISPLAY_HEIGHT_PX = 40;
export const CANDLE_DISPLAY_HEIGHT_PX = 40;
export const GHOST_DISPLAY_HEIGHT_PX = 50;

// Pencil test: multiply tint for the scribble hazards (white fill, black
// outline), so the fill turns red and the outline stays black. null leaves
// them plain white-and-black, for comparing the two looks.
export const HAZARD_TINT: number | null = 0xe53935;

// The finish gate is scaled to this height (~3.3 grid tiles, tall enough
// that the player fits under its banner); width follows the art's own
// aspect ratio.
export const FINISH_DISPLAY_HEIGHT_PX = 200;

// The spawn tombstone's height during a run, drawn behind the player. The
// editors draw it smaller (SPAWN_ICON_SIZE) so it fits one grid tile.
export const SPAWN_TOMBSTONE_HEIGHT_PX = 90;

// One beat of the finish-line victory dance (ms per pose). The finish
// gate's pulse (Juice.playFinishGateAnimation) is timed on the same beat
// so the two read as one celebration.
export const DANCE_FRAME_MS = 144;
