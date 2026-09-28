import * as Phaser from 'phaser';

// Arcade steps at a fixed 60Hz, but the screen refreshes at whatever the
// device does (120Hz ProMotion, 90Hz Android, a 60Hz monitor whose rAF
// timing drifts). Drawing bodies exactly where the last step left them
// means some frames show zero steps of motion and others two — at the
// auto-run speed that's a 0px / 11px stutter of the whole world behind a
// camera locked to the player. Instead each tracked sprite is drawn
// between its last two step positions, by how far the world's accumulator
// is into the next step (the classic "fix your timestep" interpolation).
//
// Physics itself is untouched: restore() puts every sprite back on its
// true stepped position in PRE_UPDATE, before the world steps or any game
// logic reads it, and apply() only offsets it for drawing in POST_UPDATE,
// after Arcade has written that frame's steps back to the sprite. So jump
// arcs, collisions, and every already-verified level behave exactly as at
// a plain 60Hz step — only what's drawn in between changes.

// A sprite more than this far from where the last step left it was moved
// by game code (respawn, dev warp, a bat's reset) — drawn there directly
// instead of sliding in from the old position.
const TELEPORT_EPSILON_PX = 0.01;

type Tracked = {
  sprite: Phaser.GameObjects.Sprite;
  body: Phaser.Physics.Arcade.Body;
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
  // Where apply() last drew it, so restore() can tell its own offset from
  // a teleport made between frames (a DOM Retry click lands there).
  drawnX: number;
  drawnY: number;
};

export class PhysicsInterpolation {
  private readonly world: Phaser.Physics.Arcade.World;
  private readonly tracked: Tracked[] = [];

  constructor(scene: Phaser.Scene, sprites: readonly Phaser.GameObjects.Sprite[]) {
    this.world = scene.physics.world;
    for (const sprite of sprites) {
      const body = sprite.body;
      if (!(body instanceof Phaser.Physics.Arcade.Body)) continue;
      this.tracked.push({
        sprite,
        body,
        prevX: sprite.x,
        prevY: sprite.y,
        currX: sprite.x,
        currY: sprite.y,
        drawnX: sprite.x,
        drawnY: sprite.y,
      });
    }
    this.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this);
  }

  destroy(): void {
    // Held directly: scene.physics.world is already nulled by the time a
    // shutdown reaches here, but the World itself is still a live emitter.
    this.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep, this);
    this.tracked.length = 0;
  }

  // PRE_UPDATE: back to the true stepped position before physics runs.
  restore(): void {
    for (const t of this.tracked) {
      const { sprite } = t;
      if (sprite.x === t.drawnX && sprite.y === t.drawnY) {
        sprite.x = t.currX;
        sprite.y = t.currY;
      } else {
        this.snap(t);
      }
    }
  }

  // POST_UPDATE, after Arcade's own postUpdate has moved the sprites.
  apply(): void {
    const behind = 1 - this.stepProgress();
    for (const t of this.tracked) {
      const { sprite } = t;
      if (
        !t.body.enable ||
        Math.abs(sprite.x - t.currX) > TELEPORT_EPSILON_PX ||
        Math.abs(sprite.y - t.currY) > TELEPORT_EPSILON_PX
      ) {
        this.snap(t);
      }
      sprite.x = t.currX + (t.prevX - t.currX) * behind;
      sprite.y = t.currY + (t.prevY - t.currY) * behind;
      t.drawnX = sprite.x;
      t.drawnY = sprite.y;
    }
  }

  // Where each step leaves the sprite. Arcade only writes positions back
  // to the sprite once per frame (Body.postUpdate adds position - prevFrame),
  // so this reconstructs the same value per step with the same arithmetic —
  // after postUpdate, sprite.x equals currX exactly.
  private onWorldStep(): void {
    for (const t of this.tracked) {
      if (!t.body.enable || !t.body.moves) continue;
      t.prevX = t.currX;
      t.prevY = t.currY;
      t.currX = t.sprite.x + (t.body.position.x - t.body.prevFrame.x);
      t.currY = t.sprite.y + (t.body.position.y - t.body.prevFrame.y);
    }
  }

  private snap(t: Tracked): void {
    t.prevX = t.currX = t.sprite.x;
    t.prevY = t.currY = t.sprite.y;
  }

  // 0..1: how far the world's accumulator is toward its next step. The
  // accumulator (_elapsed) is internal and untyped, hence the guarded
  // read; if Phaser ever renames it, this falls back to drawing the latest
  // step (no interpolation) rather than anything wrong.
  private stepProgress(): number {
    const elapsed: unknown = Reflect.get(this.world, '_elapsed');
    if (typeof elapsed !== 'number' || this.world.isPaused) return 1;
    return Phaser.Math.Clamp(elapsed / (1000 / this.world.fps), 0, 1);
  }
}
