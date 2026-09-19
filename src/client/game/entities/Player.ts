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

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.sprite = scene.physics.add.sprite(x, y, 'player');

    const body = this.sprite.body;
    if (!(body instanceof Phaser.Physics.Arcade.Body)) {
      throw new Error('Player sprite must have a dynamic Arcade body');
    }
    this.body = body;

    // Forgiving hitbox: smaller than the visible sprite so near-misses read
    // as survivable rather than cheap deaths (spec section 3).
    this.body.setSize(PLAYER_SIZE * 0.7, PLAYER_SIZE * 0.85);
    this.body.setOffset(PLAYER_SIZE * 0.15, PLAYER_SIZE * 0.15);

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

    if (!this.alive) {
      return;
    }

    this.sprite.setVelocityX(RUN_SPEED * this.speedMultiplier);

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

    burstParticles(this.scene, this.sprite.x, this.sprite.y, 0xff4d6d);
    this.scene.cameras.main.shake(120, 0.006);

    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1.4,
      scaleY: 0.5,
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

  reset(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.sprite.setVelocity(0, 0);
    this.sprite.setScale(1, 1);
    this.sprite.setAngle(0);
    this.body.setAllowGravity(true);
    this.msSinceGrounded = Number.POSITIVE_INFINITY;
    this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
    this.alive = true;

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

  private onJumpPressed(): void {
    this.msSinceJumpPressed = 0;
  }

  private onJumpReleased(): void {
    if (this.body.velocity.y < 0) {
      this.sprite.setVelocityY(this.body.velocity.y * JUMP_RELEASE_MULTIPLIER);
    }
  }
}
