import * as Phaser from 'phaser';
import {
  InputSystem,
  JUMP_DOWN_EVENT,
  JUMP_UP_EVENT,
} from '../systems/InputSystem';
import {
  COYOTE_TIME_MS,
  JUMP_BUFFER_MS,
  JUMP_RELEASE_MULTIPLIER,
  JUMP_VELOCITY,
  PLAYER_SIZE,
  RUN_SPEED,
} from '../constants';

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;

  private readonly body: Phaser.Physics.Arcade.Body;
  private readonly inputSystem: InputSystem;

  private alive = true;
  private msSinceGrounded = Number.POSITIVE_INFINITY;
  private msSinceJumpPressed = Number.POSITIVE_INFINITY;

  constructor(scene: Phaser.Scene, x: number, y: number) {
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

    if (!this.alive) {
      return;
    }

    this.sprite.setVelocityX(RUN_SPEED);

    const hasBufferedJump = this.msSinceJumpPressed <= JUMP_BUFFER_MS;
    const canJump = this.msSinceGrounded <= COYOTE_TIME_MS;
    if (hasBufferedJump && canJump) {
      this.sprite.setVelocityY(-JUMP_VELOCITY);
      this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
      this.msSinceGrounded = Number.POSITIVE_INFINITY;
    }
  }

  die(onDeathAnimationComplete: () => void): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);

    this.sprite.scene.tweens.add({
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
  }

  destroy(): void {
    this.inputSystem.destroy();
    this.sprite.scene.events.off(JUMP_DOWN_EVENT, this.onJumpPressed, this);
    this.sprite.scene.events.off(JUMP_UP_EVENT, this.onJumpReleased, this);
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
