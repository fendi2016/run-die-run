import * as Phaser from 'phaser';
import FlashPlugin from 'phaser4-rex-plugins/plugins/flash-plugin.js';
import {
  InputSystem,
  JUMP_DOWN_EVENT,
  JUMP_UP_EVENT,
} from '../systems/InputSystem';
import { burstParticles } from '../systems/Juice';
import {
  COYOTE_TIME_MS,
  DASH_BURST_DURATION_MS,
  DASH_BURST_MULTIPLIER,
  JUMP_BUFFER_MS,
  JUMP_RELEASE_MULTIPLIER,
  JUMP_VELOCITY,
  PLAYER_SIZE,
  RUN_SPEED,
  SPEED_BOOST_DURATION_MS,
  SPEED_BOOST_MULTIPLIER,
} from '../constants';

// Each player pose is its own named image (extracted from the old
// player-sprites-2.png grid) rather than indices into a shared spritesheet
// — easier to tell which pose is which at a glance, and to swap one out
// without recomputing a grid offset. See player/*.png in public/assets.
//
// player-run-1..6 is a genuine six-pose run cycle (drawn with alternating
// leg/arm contact poses, not near-duplicates — unlike the original 4x2
// sheet, which only had one distinct leg pose and no way to fake a second
// one that didn't look like the character spinning to face backwards).
// player-jump-tuck and player-crouch are extracted and loaded but unused
// for now — there's no airborne-tuck or landing-recovery state in the
// state machine yet.
export const PLAYER_TEXTURE_KEYS = [
  'player-idle',
  'player-run-1',
  'player-run-2',
  'player-run-3',
  'player-run-4',
  'player-run-5',
  'player-run-6',
  'player-jump-rise',
  'player-jump-tuck',
  'player-jump-fall',
  'player-crouch',
  'player-death',
] as const;

export const PLAYER_IDLE_KEY = 'player-idle';
const RUN_ANIM_KEY = 'player-run';
const RUN_KEYS = [
  'player-run-1',
  'player-run-2',
  'player-run-3',
  'player-run-4',
  'player-run-5',
  'player-run-6',
];
const RISE_KEY = 'player-jump-rise';
const FALL_KEY = 'player-jump-fall';
const DEATH_KEY = 'player-death';
// Native size of every player pose image (see the extraction script's
// output — all cropped to the same 362x362 grid cell). Arcade
// Body.setSize()/.setOffset() take *unscaled source-image* pixels — the
// body's real size is recomputed every frame as sourceSize * scale — so
// sizing the hitbox off PLAYER_SIZE (the post-setDisplaySize scale is
// ~0.09) would shrink it to a couple of pixels and let the player tunnel
// through the floor. Sizing off the source image instead scales down
// correctly alongside the sprite.
const PLAYER_FRAME_SIZE = 362;

function ensurePlayerAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists(RUN_ANIM_KEY)) {
    return;
  }
  scene.anims.create({
    key: RUN_ANIM_KEY,
    frames: RUN_KEYS.map((key) => ({ key })),
    frameRate: 22,
    repeat: -1,
  });
}

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;

  // Captured at construction rather than read back off the sprite —
  // Phaser's DisplayList destroys every game object (nulling its scene
  // reference) on a SHUTDOWN listener registered during scene boot, which
  // fires before GameScene's own `.once('shutdown', this.cleanup)`
  // listener (registered later, in create()) since event emitters run
  // listeners in registration order. By the time `destroy()` runs during
  // teardown, the sprite's scene link is already gone; this field isn't.
  private readonly scene: Phaser.Scene;
  private readonly body: Phaser.Physics.Arcade.Body;
  private readonly inputSystem: InputSystem;

  private alive = true;
  private msSinceGrounded = Number.POSITIVE_INFINITY;
  private msSinceJumpPressed = Number.POSITIVE_INFINITY;

  // Power-up state (spec section 21) — all re-collectible, so everything
  // here resets in `reset()` rather than persisting across attempts.
  private hasDoubleJump = false;
  private hasUsedAirJump = false;
  private hasShield = false;
  private shieldProtectionUntil = 0;
  private speedMultiplier = 1;
  private speedBoostTimer: Phaser.Time.TimerEvent | undefined;

  // Tap-to-start (spec: don't auto-run the instant a level loads) — while
  // true, update() skips the auto-run velocity and jump handling entirely
  // and holds the idle pose, regardless of `alive`. Only the very first
  // spawn of a run sets this (see reset()'s `waiting` param); a
  // death-restart never does, preserving the fast retry loop.
  private waitingToStart = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.sprite = scene.physics.add.sprite(x, y, PLAYER_IDLE_KEY);
    // Bottom-anchored, matching every other surface object's convention
    // (ObjectRegistry's originFor: solids top-anchored at the walkable
    // surface, hazards/spawn/finish bottom-anchored AT that same surface
    // y) — spawn.y (and EditorScene's DEFAULT_SPAWN) is authored as
    // GROUND_TOP_Y, meaning "feet touch here". Phaser's default center
    // origin would put half the sprite (and hitbox) below that y, already
    // overlapping the ground tile at spawn — Arcade Physics doesn't
    // recover from an already-overlapping dynamic/static spawn, so the
    // player free-fell through the floor every run instead of landing.
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    ensurePlayerAnims(scene);

    const body = this.sprite.body;
    if (!(body instanceof Phaser.Physics.Arcade.Body)) {
      throw new Error('Player sprite must have a dynamic Arcade body');
    }
    this.body = body;

    // Forgiving hitbox: smaller than the visible sprite so near-misses read
    // as survivable rather than cheap deaths (spec section 3).
    this.body.setSize(PLAYER_FRAME_SIZE * 0.7, PLAYER_FRAME_SIZE * 0.85);
    this.body.setOffset(PLAYER_FRAME_SIZE * 0.15, PLAYER_FRAME_SIZE * 0.15);

    this.inputSystem = new InputSystem(scene);
    scene.events.on(JUMP_DOWN_EVENT, this.onJumpPressed, this);
    scene.events.on(JUMP_UP_EVENT, this.onJumpReleased, this);
  }

  update(deltaMs: number): void {
    this.msSinceGrounded = this.body.blocked.down
      ? 0
      : this.msSinceGrounded + deltaMs;
    this.msSinceJumpPressed =
      this.msSinceJumpPressed === Number.POSITIVE_INFINITY
        ? this.msSinceJumpPressed
        : this.msSinceJumpPressed + deltaMs;
    if (this.body.blocked.down) {
      this.hasUsedAirJump = false;
    }

    if (!this.alive || this.waitingToStart) {
      return;
    }

    this.sprite.setVelocityX(RUN_SPEED * this.speedMultiplier);
    this.updateAnimation();

    const hasBufferedJump = this.msSinceJumpPressed <= JUMP_BUFFER_MS;
    const canGroundJump = this.msSinceGrounded <= COYOTE_TIME_MS;
    // Double Jump (spec section 21): one extra mid-air jump, using the
    // exact same jump input — refilled by touching the ground again, not
    // by re-collecting the power-up every time.
    const canAirJump =
      this.hasDoubleJump && !canGroundJump && !this.hasUsedAirJump;
    if (hasBufferedJump && (canGroundJump || canAirJump)) {
      this.sprite.setVelocityY(-JUMP_VELOCITY);
      this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
      if (canGroundJump) {
        this.msSinceGrounded = Number.POSITIVE_INFINITY;
      } else {
        this.hasUsedAirJump = true;
      }
    }
  }

  // Airborne swaps between the rising-leap and falling-sprawl poses off
  // velocity direction — the run cycle only plays while grounded, so it
  // never fights either airborne frame for control of the sprite.
  private updateAnimation(): void {
    if (this.body.blocked.down) {
      if (!this.sprite.anims.isPlaying) {
        this.sprite.play(RUN_ANIM_KEY);
      }
    } else {
      // stop() no-ops if nothing's playing, so no need to track whether
      // this is the first airborne frame before calling it.
      this.sprite.anims.stop();
      this.sprite.setTexture(
        this.body.velocity.y < 0 ? RISE_KEY : FALL_KEY
      );
    }
  }

  // Shield (spec section 21): absorbs the next fatal hit, then disappears.
  // Called by GameScene before treating a hazard overlap as a death, so a
  // shielded hit never reaches `die()` at all — the caller decides whether
  // to skip attribution/kill-counting for an absorbed hit.
  tryAbsorbHit(): boolean {
    if (this.scene.time.now < this.shieldProtectionUntil) return true;
    if (!this.hasShield) {
      return false;
    }
    this.hasShield = false;
    this.shieldProtectionUntil = this.scene.time.now + 350;
    this.flashSprite();
    return true;
  }

  // A quick visibility-blink so "the shield saved you" reads as a distinct
  // moment from an ordinary hazard overlap that does nothing (previously
  // both looked identical: no feedback at all).
  private flashSprite(): void {
    const plugin = this.scene.plugins.get('rexFlash');
    if (!(plugin instanceof FlashPlugin)) {
      return;
    }
    plugin.add(this.sprite, { duration: 80, repeat: 3 }).flash();
  }

  grantDoubleJump(): void {
    this.hasDoubleJump = true;
  }

  grantShield(): void {
    this.hasShield = true;
  }

  applySpeedBoost(): void {
    this.applyTimedSpeedMultiplier(
      SPEED_BOOST_MULTIPLIER,
      SPEED_BOOST_DURATION_MS
    );
  }

  // "Pickup -> immediate short forward burst" (spec section 21) — no
  // button, so the only way to make the burst readable at all is a brief,
  // stronger version of the same timed speed multiplier Speed Boost uses.
  applyDash(): void {
    this.applyTimedSpeedMultiplier(
      DASH_BURST_MULTIPLIER,
      DASH_BURST_DURATION_MS
    );
  }

  private applyTimedSpeedMultiplier(
    multiplier: number,
    durationMs: number
  ): void {
    this.speedBoostTimer?.remove();
    this.speedMultiplier = multiplier;
    this.speedBoostTimer = this.scene.time.delayedCall(durationMs, () => {
      this.speedMultiplier = 1;
      this.speedBoostTimer = undefined;
    });
  }

  die(onDeathAnimationComplete: () => void): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.sprite.anims.stop();
    this.sprite.setTexture(DEATH_KEY);

    burstParticles(this.scene, this.sprite.x, this.sprite.y, 0xff4d6d);
    this.scene.cameras.main.shake(120, 0.006);

    // Relative to the sprite's current (PLAYER_SIZE-scaled) base, not
    // absolute scale values — the sheet's native frame is 362px, so an
    // absolute scaleX of 1.4 would blow the sprite up to ~507px instead of
    // squashing it.
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX * 1.4,
      scaleY: this.sprite.scaleY * 0.5,
      angle: 25,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: onDeathAnimationComplete,
    });
  }

  freeze(): void {
    this.alive = false;
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);
  }

  // `waiting`: true for a level's very first spawn (tap-to-start gate,
  // held until beginRun() is called) — false for a death-restart, which
  // still auto-runs immediately, preserving the fast retry loop (spec
  // section 6's ~0.3-0.6s death->retry target).
  reset(x: number, y: number, waiting = false): void {
    this.sprite.setPosition(x, y);
    this.sprite.setVelocity(0, 0);
    // setDisplaySize, not setScale(1, 1) — the sprite's native frame size
    // (362px, from the source sheet) isn't PLAYER_SIZE, unlike the old
    // placeholder texture where scale 1 happened to mean "correct size".
    this.sprite.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    this.sprite.setAngle(0);
    this.body.setAllowGravity(true);
    this.msSinceGrounded = Number.POSITIVE_INFINITY;
    this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
    this.alive = true;
    this.waitingToStart = waiting;
    if (waiting) {
      this.sprite.anims.stop();
      this.sprite.setTexture(PLAYER_IDLE_KEY);
    } else {
      this.sprite.play(RUN_ANIM_KEY);
    }

    // Power-ups are re-collectible each attempt, not persistent across
    // deaths — the pickups themselves reappear too, since restarting a run
    // rebuilds the player but reuses the same already-loaded level world.
    this.hasDoubleJump = false;
    this.hasUsedAirJump = false;
    this.hasShield = false;
    this.shieldProtectionUntil = 0;
    this.speedMultiplier = 1;
    this.speedBoostTimer?.remove();
    this.speedBoostTimer = undefined;
  }

  destroy(): void {
    this.speedBoostTimer?.remove();
    this.inputSystem.destroy();
    this.scene.events.off(JUMP_DOWN_EVENT, this.onJumpPressed, this);
    this.scene.events.off(JUMP_UP_EVENT, this.onJumpReleased, this);
  }

  // Exposed so GameScene can tell whether the very first tap has already
  // landed (e.g. to know when to hide the tap-to-start prompt and start
  // the run timer) without duplicating the "was this the start tap"
  // decision in two places.
  get isWaitingToStart(): boolean {
    return this.waitingToStart;
  }

  private onJumpPressed(): void {
    if (this.waitingToStart) {
      // The tap that dismisses tap-to-start begins the run — it doesn't
      // also register as a jump (the player hasn't landed anywhere to
      // jump from yet, and buffering one here would just fire the instant
      // they touch ground).
      this.waitingToStart = false;
      // GameScene.update() calls player.update() (and thus
      // updateAnimation()) before it resumes physics for this same
      // transition frame, so body.blocked.down still reads stale-false —
      // updateAnimation would otherwise read that as airborne and flash
      // the fall pose for one frame. The player is guaranteed grounded
      // here (tap-to-start only ever holds at a real spawn/landing spot),
      // so force it rather than trusting the not-yet-stepped physics body.
      this.body.blocked.down = true;
      this.sprite.play(RUN_ANIM_KEY);
      return;
    }
    this.msSinceJumpPressed = 0;
  }

  private onJumpReleased(): void {
    if (this.body.velocity.y < 0) {
      this.sprite.setVelocityY(this.body.velocity.y * JUMP_RELEASE_MULTIPLIER);
    }
  }
}
