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
export const COYOTE_TIME_MS = 100;
export const JUMP_BUFFER_MS = 130;
export const PLAYER_SIZE = 80;
// The editor/curse spawn-marker icon reuses the player idle texture but
// must fit inside one grid tile (unlike the real player, which is allowed
// to overhang neighboring tiles while running) — otherwise it visually
// overlaps whatever's placed in the next column over.
export const SPAWN_ICON_SIZE = Math.min(PLAYER_SIZE, GRID_CELL_SIZE);

// Finishing is a rarer, deliberate moment (not the tight death/retry loop),
// so this affords time to read the CLEAR! result — time, rank, PB, WR —
// after the leaderboard round-trip resolves, before auto-restarting.
export const FINISH_RESTART_DELAY_MS = 2500;

// The finish trigger's hitbox is grown to this height (LevelLoader) so a
// jump can't clear it and sail past the level's edge — a single jump peaks
// at JUMP_VELOCITY^2 / (2 * GRAVITY_Y) ≈ 107px above ground, and this leaves
// generous margin above that. The visible trophy sprite itself (64px tall)
// is left untouched; only the overlap sensor is taller.
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

// spike.webp's native art is a stubby 40x40 square that reads as a low
// pebble rather than something you'd die on — stretched taller (width
// unchanged) so it reads as a proper upright spike. Bottom-anchored origin
// (see originFor) means the extra height grows upward from the ground, not
// down into it.
export const SPIKE_DISPLAY_HEIGHT_PX = 60;

// bat.webp's canvas grew wider (37px -> 53px) when its missing second wing
// was reconstructed — matches its original 40px-tall footprint (aspect
// preserved, not stretched) so the in-level hazard's hitbox doesn't grow
// just because the art got fixed.
export const BAT_DISPLAY_HEIGHT_PX = 40;

// The finish bell's 4 frames (idle/hit/ringing/success) are cropped to
// different native pixel sizes (motion-lines and ghosts extend the canvas
// unevenly), so they're scaled to a shared target height rather than a
// fixed display size — width is left to each frame's own aspect ratio.
export const FINISH_DISPLAY_HEIGHT_PX = 150;

// One beat of the finish-line victory dance (ms per pose). The finish bell's
// swing (Juice.playFinishBellAnimation) is timed on the same beat so the
// two read as one celebration.
export const DANCE_FRAME_MS = 144;
