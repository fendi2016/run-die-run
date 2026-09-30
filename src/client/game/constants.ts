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
// Draws the pencil wider than its art without touching the physics sprite
// or hitbox (Player's separate display sprite only) — purely how he looks.
export const PLAYER_DISPLAY_WIDTH_SCALE = 1.25;
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

// In landscape the run camera shows LOGICAL_HEIGHT / CAMERA_ZOOM_BOOST world px of
// height, so everything (player, traps, platforms) draws this much bigger
// with gameplay untouched. Above 1 the level no longer fits vertically, so
// the camera eases after the player's y (CAMERA_FOLLOW_Y_LERP per frame),
// keeping them CAMERA_PLAYER_Y_ANCHOR of the way down the screen.
export const CAMERA_ZOOM_BOOST = 1.3;
export const CAMERA_FOLLOW_Y_LERP = 0.12;
export const CAMERA_PLAYER_Y_ANCHOR = 0.6;

// Power-up tuning (spec section 21). All auto-activate on pickup, all
// deterministic (no randomness), none add a new input.
export const SPEED_BOOST_MULTIPLIER = 1.6;
export const SPEED_BOOST_DURATION_MS = 1400;
// Wings: one extra jump in mid-air, kept until used (or the attempt ends).
// Stopwatch: every moving trap runs at this fraction of its speed for a while.
export const SLOW_TIME_SCALE = 0.4;
export const SLOW_TIME_DURATION_MS = 4000;
// Star: every trap is harmless for this long (falling still kills).
export const STAR_DURATION_MS = 5000;
// Amplitude/period of a Moving Saw's deterministic back-and-forth path.
export const MOVING_SAW_AMPLITUDE_PX = 90;
export const MOVING_SAW_PERIOD_MS = 900;
// One full spin of the sawblade art, driven by a continuous angle tween
// (ObjectRegistry) rather than the old 8-frame saw-spin sheet.
export const SAW_ROTATION_PERIOD_MS = 700;
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
// The stapler art (candle type) is wider than the spikes it replaced; its
// hitbox stays the old spikes' 28px width so the hazard plays the same.
export const CANDLE_HITBOX_WIDTH_PX = 28;
export const GHOST_DISPLAY_HEIGHT_PX = 50;

// Spikes (hazards/spikes.webp): low and wide, unlike every other hazard here.
// Display height only — width follows the art's own ~1.9:1 aspect ratio via
// setScale, landing just under one grid cell wide. The hitbox is narrower
// than the display width so a jump that clips the very edge of the art
// still reads as a clean clear.
export const SPIKES_DISPLAY_HEIGHT_PX = 34;
export const SPIKES_HITBOX_WIDTH_PX = 46;

// Traps from the scribble "traps and powerups" sheet. Display sizes keep
// each art's own aspect ratio; hitboxes are a bit smaller than the drawing
// (spikes/motion scribbles at the edges) so a graze reads fairly.
// The saw/movingSaw keep the old 40x40 footprint; only the art changed.
export const SAW_DISPLAY_SIZE_PX = 40;
// Hangs from a ceiling or platform above: one cell wide, spikes pointing down.
export const CEILING_SPIKES_DISPLAY_WIDTH_PX = GRID_CELL_SIZE;
export const CEILING_SPIKES_HITBOX_WIDTH_PX = 46;
export const SPIKE_MINE_DISPLAY_HEIGHT_PX = 48;
export const SPIKE_MINE_HITBOX_PX = 34;
// A Zapper is lethal for the first ZAPPER_ON_FRACTION of every cycle and
// harmless (dimmed) for the rest.
export const ZAPPER_DISPLAY_HEIGHT_PX = 54;
export const ZAPPER_HITBOX_PX = 32;
export const ZAPPER_PERIOD_MS = 3000;
export const ZAPPER_ON_FRACTION = 0.5;
// Swinging Mace: the beam's bolt sits near the top of its placed cell and
// the ball swings below it, through roughly the next two cells down.
export const MACE_ART_SCALE = 0.55;
export const MACE_PIVOT_INSET_PX = 14;
export const MACE_SWING_DEG = 60;
export const MACE_PERIOD_MS = 2200;
export const MACE_HITBOX_PX = 40;
// Crusher: sits on its surface, lifts up, hangs there, then slams down.
export const CRUSHER_DISPLAY_HEIGHT_PX = 70;
export const CRUSHER_HITBOX_WIDTH_PX = 52;
export const CRUSHER_LIFT_PX = 150;
export const CRUSHER_PERIOD_MS = 2600;
// Power-up pickups all draw at one size.
export const POWERUP_DISPLAY_HEIGHT_PX = 56;

// The finish pencil sharpener is scaled to this height (2 grid tiles, so
// its mouth sits at the pencil's tip height); width follows the art's own
// aspect ratio (roughly square).
export const FINISH_DISPLAY_HEIGHT_PX = 120;

// The spawn pencil case's height during a run, drawn behind the player —
// the same height as the player, so the pencil reads as having just come
// out of it. The editors draw it smaller (SPAWN_ICON_SIZE) so it fits one
// grid tile.
export const SPAWN_CASE_HEIGHT_PX = PLAYER_SIZE;
// The player starts just right of the case, this far from its right edge
// (about the pencil's visual half-width plus a small gap), so the case is
// never hidden behind him. A spawn authored too close to the level's left
// edge for the case to fit is nudged right; the editor's spawn buffer
// (EDITOR_SPAWN_BUFFER_CELLS) keeps hazards well clear of that nudge.
export const SPAWN_CASE_CLEARANCE_PX = 24;
// Sinks the case's base into the ground tile's ink line (the tiles draw
// over it) so it rests on the drawn edge instead of hovering above it.
export const SPAWN_CASE_SINK_PX = 4;

