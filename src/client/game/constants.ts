// Gameplay tuning values (spec section 3). Client-only — the server never
// needs to know jump physics, only final validated positions/times.
export const RUN_SPEED = 260; // px/s, constant auto-run speed
export const GRAVITY_Y = 1800; // px/s^2
export const JUMP_VELOCITY = 620; // px/s, initial upward velocity on jump
export const JUMP_RELEASE_MULTIPLIER = 0.5; // cuts the jump short if released early
export const COYOTE_TIME_MS = 100;
export const JUMP_BUFFER_MS = 130;
export const PLAYER_SIZE = 80;

// Total budget for the death→retry loop must land inside the spec's
// ~0.3–0.6s target (section 6); this is the animation portion of that.
export const DEATH_RESTART_DELAY_MS = 350;

// Finishing is a rarer, deliberate moment (not the tight death/retry loop),
// so this affords time to read the CLEAR! result — time, rank, PB, WR —
// after the leaderboard round-trip resolves, before auto-restarting.
export const FINISH_RESTART_DELAY_MS = 2500;

// How far from the left edge of the screen the player sits while running,
// so there's always more upcoming level geometry visible than trailing.
export const PLAYER_SCREEN_ANCHOR = 0.35;

// Power-up tuning (spec section 21). All auto-activate on pickup, all
// deterministic (no randomness), none add a new input.
export const SPEED_BOOST_MULTIPLIER = 1.6;
export const SPEED_BOOST_DURATION_MS = 1400;
// Dash is "an automatic effect when collected" (spec), not a button — an
// immediate, short, stronger burst than Speed Boost rather than a sustained
// buff, reusing the same timed-multiplier mechanism under the hood.
export const DASH_BURST_MULTIPLIER = 2.4;
export const DASH_BURST_DURATION_MS = 220;
export const SLOW_TIME_HAZARD_SCALE = 0.35;
export const SLOW_TIME_DURATION_MS = 3000;
// Amplitude/period of a Moving Saw's deterministic back-and-forth path.
export const MOVING_SAW_AMPLITUDE_PX = 90;
export const MOVING_SAW_PERIOD_MS = 900;
// A Moving Platform travels farther and slower than a Moving Saw — it
// needs to be rideable/predictable, not a fast-twitch hazard.
export const MOVING_PLATFORM_AMPLITUDE_PX = 160;
export const MOVING_PLATFORM_PERIOD_MS = 2200;
