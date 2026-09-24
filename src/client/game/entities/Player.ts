import * as Phaser from 'phaser';
import FlashPlugin from 'phaser4-rex-plugins/plugins/flash-plugin.js';
import {
  InputSystem,
  JUMP_DOWN_EVENT,
  JUMP_UP_EVENT,
} from '../systems/InputSystem';
import {
  attachElectricShield,
  destroyElectricShield,
  playDeathExplosion,
  playHyperspeedTrail,
  playPlayerShatter,
  playSlideDust,
  playSlideImpact,
} from '../systems/Juice';
import { playSfx } from '../systems/Sfx';
import {
  COYOTE_TIME_MS,
  DANCE_FRAME_MS,
  DOUBLE_TAP_MS,
  JUMP_BUFFER_MS,
  JUMP_RELEASE_MULTIPLIER,
  JUMP_VELOCITY,
  PLAYER_SIZE,
  RUN_SPEED,
  SLIDE_DURATION_MS,
  SLIDE_HITBOX_HEIGHT,
  SPEED_BOOST_DURATION_MS,
  SPEED_BOOST_MULTIPLIER,
} from '../constants';

// Each player pose is its own named image (extracted from the old
// player-sprites-2.webp grid) rather than indices into a shared spritesheet
// — easier to tell which pose is which at a glance, and to swap one out
// without recomputing a grid offset. See player/*.webp in public/assets.
//
// player-run-1..6 is a genuine six-pose run cycle (drawn with alternating
// leg/arm contact poses, not near-duplicates — unlike the original 4x2
// sheet, which only had one distinct leg pose and no way to fake a second
// one that didn't look like the character spinning to face backwards).
// player-slide-1..8 is the slide: drop in (1-2), slide (3-6), get back up
// (7-8) — see SLIDE_ANIM_KEY.
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
  'player-slide-1',
  'player-slide-2',
  'player-slide-3',
  'player-slide-4',
  'player-slide-5',
  'player-slide-6',
  'player-slide-7',
  'player-slide-8',
  'player-dance-1',
  'player-dance-2',
  'player-dance-3',
  'player-dance-4',
  'player-dance-5',
  'player-dance-6',
  'player-dance-7',
  'player-dance-8',
  'player-dance-9',
  'player-dance-10',
  'player-dance-11',
  'player-dance-12',
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
const TUCK_KEY = 'player-jump-tuck';
const FALL_KEY = 'player-jump-fall';
const SLIDE_ANIM_KEY = 'player-slide';
// The slide frames are wider than every other pose (legs stretch forward)
// but share its 362px height, pixel scale, and head
// position, so they draw at PLAYER_BASE_SCALE without the robot changing
// size; only the hitbox's x offset needs to know the wider canvas.
const SLIDE_FRAME_WIDTH = 494;
// Share of SLIDE_DURATION_MS each slide frame holds: quick drop-in and
// get-up, longer on the four sliding frames.
const SLIDE_FRAME_WEIGHTS = [0.09, 0.09, 0.16, 0.16, 0.16, 0.16, 0.09, 0.09];
// Dust puff cadence under the feet while sliding (Juice.playSlideDust).
const SLIDE_DUST_INTERVAL_MS = 200;
// Standing hitbox, in source-frame fractions (see PLAYER_FRAME_SIZE):
// forgiving width, bottom flush with the feet. The slide variant keeps the
// same width and bottom, just shorter (SLIDE_HITBOX_HEIGHT).
const HITBOX_WIDTH = 0.7;
const HITBOX_HEIGHT = 0.85;
const DANCE_ANIM_KEY = 'player-dance';
// Reordered from the source sheet's raster order (1 is a near-idle pose —
// starting the loop on it would read as "nothing happened" for a beat)
// so the finish dance leads with a distinct gesture and only cycles back
// through the calm pose as a brief breather before repeating.
const DANCE_KEYS = [
  'player-dance-2',
  'player-dance-3',
  'player-dance-4',
  'player-dance-5',
  'player-dance-6',
  'player-dance-7',
  'player-dance-8',
  'player-dance-9',
  'player-dance-10',
  'player-dance-11',
  'player-dance-12',
  'player-dance-1',
];
// Plays once (repeat: 0) for the ascent — a brief rise pose that hands off
// to a held tuck frame, giving the apex an actual pose instead of holding
// the leap pose for the entire ascent. The fall half stays a direct,
// velocity-driven setTexture (see updateAnimation) rather than joining this
// animation — ascent length varies a lot with how long the jump button was
// held (JUMP_RELEASE_MULTIPLIER can cut it very short), so baking the fall
// into a fixed-duration timeline would desync from the actual arc; a
// physics-triggered cut can't.
const JUMP_ASCEND_ANIM_KEY = 'player-jump-ascend';
// Native size of every player pose image (see the extraction script's
// output — all cropped to the same 362x362 grid cell). Arcade
// Body.setSize()/.setOffset() take *unscaled source-image* pixels — the
// body's real size is recomputed every frame as sourceSize * scale — so
// sizing the hitbox off PLAYER_SIZE (the post-setDisplaySize scale is
// ~0.09) would shrink it to a couple of pixels and let the player tunnel
// through the floor. Sizing off the source image instead scales down
// correctly alongside the sprite.
const PLAYER_FRAME_SIZE = 362;
// How far left of the player's center the Speed Boost trail anchors (see
// syncEffectSprites/applySpeedBoost) — not half of PLAYER_SIZE's display
// box, which is where the box edge is, not where the character's actual
// drawn pixels are: the run/idle poses have 36-66px of transparent padding
// baked into their 362px source canvas (measured directly), ~8-15px at
// PLAYER_SIZE's display scale, so anchoring at the true box edge left a
// visible gap. This stays under that padding's smallest value across every
// pose, so the trail always overlaps the visible character by a few px
// rather than sometimes falling short.
const HYPERSPEED_BACK_OFFSET_PX = 18;
// Per-frame hold times (ms) for the run cycle, in place of a flat frameRate.
// run-1/4 are the contact poses (foot planted) and read best with a beat of
// hang time; run-2/5 are the fast mid-stride recoil; run-3/6 are the
// high-point passing poses. Holding contact longer than passing is the same
// asymmetric timing classic hand-drawn walk/run cycles use to sell weight
// and stride rather than a mechanical, evenly-spaced frame flip.
const RUN_FRAME_DURATIONS_MS: readonly number[] = [70, 38, 52, 70, 38, 52];
// Squash on contact, stretch through the passing/high point — synced to the
// same six frames via ANIMATION_UPDATE (see onAnimFrameUpdate). Multiplied
// against the base PLAYER_SIZE scale, not set absolutely.
const RUN_SCALE_X_FACTORS: readonly number[] = [
  1.05, 0.99, 0.96, 1.05, 0.99, 0.96,
];
const RUN_SCALE_Y_FACTORS: readonly number[] = [
  0.94, 1.02, 1.06, 0.94, 1.02, 1.06,
];
// Same trick as the run cycle's squash/stretch above, applied to the dance
// loop — without it the dance is just a slideshow of static poses cut on
// every frame, since none of the source art itself has any built-in
// squash/stretch. Alternating compress/stretch every frame reads as a
// bounce synced exactly to the beat the pose changes land on (a tween
// wouldn't stay locked to that beat — see onAnimFrameUpdate).
const DANCE_SCALE_X_FACTORS: readonly number[] = [
  1.08, 0.95, 1.08, 0.95, 1.08, 0.95, 1.08, 0.95, 1.08, 0.95, 1.08, 0.95,
];
const DANCE_SCALE_Y_FACTORS: readonly number[] = [
  0.92, 1.07, 0.92, 1.07, 0.92, 1.07, 0.92, 1.07, 0.92, 1.07, 0.92, 1.07,
];
type AnimScaleTable = {
  keys: readonly string[];
  scaleX: readonly number[];
  scaleY: readonly number[];
};
// Keyed by animation key rather than branching in onAnimFrameUpdate itself
// — keeps each pose list paired with its own matching scale arrays instead
// of relying on three parallel ternaries staying in sync by hand.
const ANIM_SCALE_TABLES: Record<string, AnimScaleTable> = {
  [RUN_ANIM_KEY]: {
    keys: RUN_KEYS,
    scaleX: RUN_SCALE_X_FACTORS,
    scaleY: RUN_SCALE_Y_FACTORS,
  },
  [DANCE_ANIM_KEY]: {
    keys: DANCE_KEYS,
    scaleX: DANCE_SCALE_X_FACTORS,
    scaleY: DANCE_SCALE_Y_FACTORS,
  },
};
// A vertical root-motion "bob" (translating sprite.y directly, on top of
// the squash-stretch above) was tried here and reverted — Arcade Physics'
// Body.preUpdate calls updateFromGameObject() *every frame*, which resyncs
// the body's simulated position straight from the sprite's current
// transform (including y) before the physics step runs. Any manual sprite.y
// offset is therefore read back as "the body actually moved", which
// desynced ground contact for a step at a time: blocked.down flickered
// false, the falling branch below fired anims.stop(), and the run cycle
// kept getting reset to frame 0 before it could visibly advance — the
// "jitters while running" bug. Scale changes technically perturb the same
// formula too (position.y factors in transform.scaleY), but empirically
// stay within Arcade's collision tolerance; a direct y translate did not.
// Do not reintroduce a bob via sprite.y on a physics-driven sprite without
// decoupling visuals from the physics body first (e.g. a separate
// non-physics display sprite mirroring this one's position).
const PLAYER_BASE_SCALE = PLAYER_SIZE / PLAYER_FRAME_SIZE;

function ensurePlayerAnims(scene: Phaser.Scene): void {
  if (!scene.anims.exists(RUN_ANIM_KEY)) {
    scene.anims.create({
      key: RUN_ANIM_KEY,
      frames: RUN_KEYS.map((key, i) => ({
        key,
        duration: RUN_FRAME_DURATIONS_MS[i] ?? 45,
      })),
      // frameRate is ignored once every frame has an explicit duration, but
      // Phaser's AnimationConfig requires one to be set.
      frameRate: 22,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(JUMP_ASCEND_ANIM_KEY)) {
    scene.anims.create({
      key: JUMP_ASCEND_ANIM_KEY,
      frames: [
        { key: RISE_KEY, duration: 90 },
        { key: TUCK_KEY, duration: 1000 },
      ],
      frameRate: 22,
      // Plays through once and holds on the tuck frame — see the
      // JUMP_ASCEND_ANIM_KEY comment above for why the fall half isn't
      // joined to this same timeline.
      repeat: 0,
    });
  }
  if (!scene.anims.exists(SLIDE_ANIM_KEY)) {
    scene.anims.create({
      key: SLIDE_ANIM_KEY,
      frames: SLIDE_FRAME_WEIGHTS.map((weight, i) => ({
        key: `player-slide-${i + 1}`,
        duration: Math.round(SLIDE_DURATION_MS * weight),
      })),
      frameRate: 22,
      repeat: 0,
    });
  }
  if (!scene.anims.exists(DANCE_ANIM_KEY)) {
    scene.anims.create({
      key: DANCE_ANIM_KEY,
      frames: DANCE_KEYS.map((key) => ({ key, duration: DANCE_FRAME_MS })),
      frameRate: 22,
      repeat: -1,
    });
  }
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
  // Double-tap: a tap on the ground starts `tapWaitMs` (ms since that tap,
  // null when not waiting). A second tap inside DOUBLE_TAP_MS slides;
  // otherwise the jump fires when the wait runs out. `tapHeldMs` records a
  // release during the wait (how long the tap was held), and
  // `releaseCutInMs` replays that release the same time after lift-off, so
  // the arc is exactly what the tap would have given without the wait.
  // `slideRemainingMs` > 0 while sliding.
  private tapWaitMs: number | null = null;
  private tapHeldMs: number | null = null;
  private releaseCutInMs: number | null = null;
  private slideRemainingMs = 0;
  private slideDustMs = 0;

  // Power-up state (spec section 21) — all re-collectible, so everything
  // here resets in `reset()` rather than persisting across attempts.
  private hasShield = false;
  private shieldProtectionRemainingMs = 0;
  private speedMultiplier = 1;
  private speedBoostTimer: Phaser.Time.TimerEvent | undefined;
  // Purely cosmetic escorts for the two power-ups above — neither drives
  // gameplay state, just repositioned onto the player every update() tick
  // (syncEffectSprites) for as long as they're active. undefined whenever
  // not currently shown, so presence alone doubles as "is one showing".
  private shieldSprite: Phaser.GameObjects.Sprite | undefined;
  private hyperspeedSprite: Phaser.GameObjects.Sprite | undefined;

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
    this.setHitboxHeight(HITBOX_HEIGHT);

    this.inputSystem = new InputSystem(scene);
    scene.events.on(JUMP_DOWN_EVENT, this.onJumpPressed, this);
    scene.events.on(JUMP_UP_EVENT, this.onJumpReleased, this);
    this.sprite.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimFrameUpdate,
      this
    );
  }

  // Drives the run cycle's and dance loop's squash/stretch bounce
  // frame-by-frame instead of a tween — a tween racing the animation's own
  // frame timing would drift out of sync as soon as RUN_FRAME_DURATIONS_MS's
  // asymmetric holds (or a future non-uniform dance timing) kick in. Keyed
  // off the sprite's current texture rather than AnimationFrame.index since
  // each pose is its own texture, not a spritesheet index.
  private onAnimFrameUpdate(anim: Phaser.Animations.Animation): void {
    const table = ANIM_SCALE_TABLES[anim.key];
    if (!table) {
      return;
    }
    const poseIndex = table.keys.indexOf(this.sprite.texture.key);
    if (poseIndex === -1) {
      return;
    }
    this.sprite.setScale(
      PLAYER_BASE_SCALE * (table.scaleX[poseIndex] ?? 1),
      PLAYER_BASE_SCALE * (table.scaleY[poseIndex] ?? 1)
    );
  }

  // Neither effect sprite has any position logic of its own (Juice's
  // attachElectricShield/playHyperspeedTrail just place-and-return) — this
  // is what actually makes them "escort" the player. Runs unconditionally,
  // ahead of update()'s alive/waitingToStart early-return, since a sprite
  // can still be showing in the single frame death/freeze fires in (both
  // explicitly destroy their own escorts, but only after this would've
  // already run this frame).
  private syncEffectSprites(): void {
    const centerY = this.sprite.y - PLAYER_SIZE / 2;
    this.shieldSprite?.setPosition(this.sprite.x, centerY);
    // Anchored near the player's back, not their center — the player
    // always auto-runs rightward, and combined with the trail's own
    // trailing-edge origin (see Juice.playHyperspeedTrail) this reads as
    // streaks coming off the character's backside instead of a burst
    // plastered over their whole body. HYPERSPEED_BACK_OFFSET_PX, not
    // PLAYER_SIZE / 2 — the run/idle frames themselves have 8-15px of
    // transparent padding baked into their source art (measured directly),
    // so anchoring at the true display-box edge left a visible gap between
    // the trail and the actual visible character (user report: "not
    // touching the character").
    this.hyperspeedSprite?.setPosition(
      this.sprite.x - HYPERSPEED_BACK_OFFSET_PX,
      centerY
    );
  }

  // Instant removal (no break/fade tween, unlike tryAbsorbHit's own use of
  // destroyElectricShield) — called when the run itself is ending or
  // restarting, where the escort disappearing a frame early is invisible
  // next to the much bigger death/dance/reset transition already playing.
  private clearEffectSprites(): void {
    this.shieldSprite?.destroy();
    this.shieldSprite = undefined;
    this.hyperspeedSprite?.destroy();
    this.hyperspeedSprite = undefined;
  }

  update(deltaMs: number): void {
    this.syncEffectSprites();
    this.shieldProtectionRemainingMs = Math.max(0, this.shieldProtectionRemainingMs - deltaMs);
    this.msSinceGrounded = this.body.blocked.down
      ? 0
      : this.msSinceGrounded + deltaMs;
    this.msSinceJumpPressed =
      this.msSinceJumpPressed === Number.POSITIVE_INFINITY
        ? this.msSinceJumpPressed
        : this.msSinceJumpPressed + deltaMs;

    if (!this.alive || this.waitingToStart) {
      return;
    }

    this.sprite.setVelocityX(RUN_SPEED * this.speedMultiplier);
    this.updateSlide(deltaMs);
    this.updateAnimation();

    if (this.releaseCutInMs !== null) {
      this.releaseCutInMs -= deltaMs;
      if (this.releaseCutInMs <= 0) {
        this.releaseCutInMs = null;
        this.cutJump();
      }
    }

    if (this.tapWaitMs !== null) {
      this.tapWaitMs += deltaMs;
      if (this.tapWaitMs >= DOUBLE_TAP_MS) {
        // No second tap: it was a jump. The tap happened on the ground, so
        // coyote time counts from then, not from now.
        const tapWasGrounded =
          this.msSinceGrounded <= COYOTE_TIME_MS + this.tapWaitMs;
        this.tapWaitMs = null;
        if (tapWasGrounded) {
          this.jump();
          this.releaseCutInMs = this.tapHeldMs;
        }
      }
      return;
    }

    const hasBufferedJump = this.msSinceJumpPressed <= JUMP_BUFFER_MS;
    const canGroundJump = this.msSinceGrounded <= COYOTE_TIME_MS;
    if (hasBufferedJump && canGroundJump) this.jump();
  }

  private jump(): void {
    // Tapping mid-slide jumps straight out of it.
    this.endSlide();
    this.releaseCutInMs = null;
    this.sprite.setVelocityY(-JUMP_VELOCITY);
    this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
    this.msSinceGrounded = Number.POSITIVE_INFINITY;
    playSfx(this.scene, 'jump');
  }

  private get isSliding(): boolean {
    return this.slideRemainingMs > 0;
  }

  // Bottom stays at the feet (offset + height = the full frame), so
  // shrinking for a slide never lifts the player off the ground or sinks
  // them into it.
  // `frameWidth`: the source width of the frames about to be shown, so the
  // hitbox stays centered under the robot on the wider slide frames.
  private setHitboxHeight(fraction: number, frameWidth = PLAYER_FRAME_SIZE): void {
    const width = PLAYER_FRAME_SIZE * HITBOX_WIDTH;
    this.body.setSize(width, PLAYER_FRAME_SIZE * fraction);
    this.body.setOffset((frameWidth - width) / 2, PLAYER_FRAME_SIZE * (1 - fraction));
  }

  private startSlide(): void {
    this.slideRemainingMs = SLIDE_DURATION_MS;
    this.slideDustMs = SLIDE_DUST_INTERVAL_MS;
    this.setHitboxHeight(SLIDE_HITBOX_HEIGHT, SLIDE_FRAME_WIDTH);
    this.sprite.setScale(PLAYER_BASE_SCALE, PLAYER_BASE_SCALE);
    this.sprite.play(SLIDE_ANIM_KEY);
    this.sprite.anims.timeScale = 1;
    // Just behind the feet, at shin height, as the slide kicks off.
    playSlideImpact(this.scene, this.sprite.x - 20, this.sprite.y - 22);
    playSlideDust(this.scene, this.sprite.x - 10, this.sprite.y, 1.8);
    playSfx(this.scene, 'slide');
  }

  private endSlide(): void {
    const wasSliding = this.isSliding;
    this.slideRemainingMs = 0;
    if (wasSliding) this.setHitboxHeight(HITBOX_HEIGHT);
  }

  private updateSlide(deltaMs: number): void {
    if (!this.isSliding) return;
    // Sliding off a ledge ends it — a crouched hitbox mid-fall would only
    // make hazards in the air easier to dodge.
    if (this.msSinceGrounded > COYOTE_TIME_MS) {
      this.endSlide();
      return;
    }
    if (this.slideRemainingMs <= deltaMs) {
      this.endSlide();
      return;
    }
    this.slideRemainingMs -= deltaMs;
    this.slideDustMs -= deltaMs;
    if (this.slideDustMs <= 0) {
      this.slideDustMs += SLIDE_DUST_INTERVAL_MS;
      playSlideDust(this.scene, this.sprite.x - 16, this.sprite.y, 1.3);
    }
  }

  // Airborne swaps between the rising-leap and falling-sprawl poses off
  // velocity direction — the run cycle only plays while grounded, so it
  // never fights either airborne frame for control of the sprite.
  private updateAnimation(): void {
    if (this.isSliding) {
      // startSlide already started the animation.
      return;
    }
    if (this.body.blocked.down) {
      if (
        !this.sprite.anims.isPlaying ||
        this.sprite.anims.getName() === SLIDE_ANIM_KEY
      ) {
        this.sprite.play(RUN_ANIM_KEY);
      }
      // Leg-cycle rate tracks actual ground speed — Speed Boost (1.6x)
      // multiplies RUN_SPEED but not the animation's own frame durations,
      // so without this the character's feet would keep cycling at the
      // normal-speed rate while sliding across the ground noticeably
      // faster than the legs suggest (a skating/moonwalk artifact instead
      // of a genuinely faster run).
      this.sprite.anims.timeScale = this.speedMultiplier;
      return;
    }

    // Undo the run cycle's squash/stretch (onAnimFrameUpdate) — otherwise
    // whichever pose was mid-bounce when the player left the ground stays
    // stretched/squashed for the entire jump, shared by both airborne cases
    // below.
    this.sprite.setScale(PLAYER_BASE_SCALE, PLAYER_BASE_SCALE);
    if (this.body.velocity.y < 0) {
      // Ascending: play the rise→tuck sequence once instead of a hard cut
      // straight to a single rise texture — see JUMP_ASCEND_ANIM_KEY.
      // getName() keeps returning this anim's key after it completes (the
      // tuck frame just holds), so this only calls play() on the frame the
      // player actually leaves the ground.
      if (this.sprite.anims.getName() !== JUMP_ASCEND_ANIM_KEY) {
        this.sprite.play(JUMP_ASCEND_ANIM_KEY);
      }
    } else {
      // Falling: a direct, physics-driven cut rather than an animation —
      // see JUMP_ASCEND_ANIM_KEY's comment on why the descent isn't baked
      // into a fixed-duration timeline.
      this.sprite.anims.stop();
      this.sprite.setTexture(FALL_KEY);
    }
  }

  // Shield (spec section 21): absorbs the next fatal hit, then disappears.
  // Called by GameScene before treating a hazard overlap as a death, so a
  // shielded hit never reaches `die()` at all — the caller decides whether
  // to skip attribution/kill-counting for an absorbed hit.
  tryAbsorbHit(): boolean {
    if (this.shieldProtectionRemainingMs > 0) return true;
    if (!this.hasShield) {
      return false;
    }
    this.hasShield = false;
    this.shieldProtectionRemainingMs = 350;
    this.flashSprite();
    if (this.shieldSprite) {
      destroyElectricShield(this.scene, this.shieldSprite);
      this.shieldSprite = undefined;
    }
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

  grantShield(): void {
    this.hasShield = true;
    // Re-collecting while already shielded (the power-up is re-collectible
    // — see the Power-up state comment above) shouldn't stack a second aura
    // on top of the one already showing.
    if (this.shieldSprite) {
      return;
    }
    this.shieldSprite = attachElectricShield(
      this.scene,
      this.sprite.x,
      this.sprite.y - PLAYER_SIZE / 2
    );
  }

  applySpeedBoost(): void {
    this.applyTimedSpeedMultiplier(
      SPEED_BOOST_MULTIPLIER,
      SPEED_BOOST_DURATION_MS
    );
    // Re-collecting mid-boost cuts the old trail immediately rather than
    // fading it — it's about to be replaced by a fresh one at full alpha
    // anyway, so the fade would only ever be visible for a couple of
    // frames.
    this.hyperspeedSprite?.destroy();
    const trail = playHyperspeedTrail(
      this.scene,
      this.sprite.x - HYPERSPEED_BACK_OFFSET_PX,
      this.sprite.y - PLAYER_SIZE / 2,
      SPEED_BOOST_DURATION_MS
    );
    // playHyperspeedTrail self-destroys on a timer — this just keeps
    // syncEffectSprites from calling setPosition on it afterward. Guarded
    // by identity since a re-trigger above may already have replaced
    // `hyperspeedSprite` with a newer trail by the time this fires.
    trail.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hyperspeedSprite === trail) {
        this.hyperspeedSprite = undefined;
      }
    });
    this.hyperspeedSprite = trail;
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

  // No completion callback: death used to auto-restart after this VFX
  // finished, but that's now gated on an explicit Retry tap (DeathPanel)
  // instead, so nothing needs to know when it ends.
  die(): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.clearEffectSprites();
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.sprite.anims.stop();

    // "Ripped apart, then explodes" (user ask, replacing the old single
    // frozen player-death pose + squash tween): shatter whatever frame the
    // player was actually on into flying pieces, hide the real sprite
    // (reset() brings it back visible on retry), then let the fireball
    // consume the spot. See Juice.playPlayerShatter/playDeathExplosion.
    playPlayerShatter(this.scene, this.sprite.x, this.sprite.y, this.sprite.texture.key, PLAYER_SIZE);
    this.sprite.setVisible(false);
    playDeathExplosion(this.scene, this.sprite.x, this.sprite.y);
    this.scene.cameras.main.shake(120, 0.006);
    playSfx(this.scene, 'death');
  }

  // Called once, when the finish line is reached (see GameScene.onFinishReached
  // — the only call site). Swaps the run cycle for a victory dance loop
  // rather than just freezing on the idle pose, so reaching the finish
  // reads as a distinct celebratory beat instead of the character just
  // stopping mid-stride.
  freeze(): void {
    this.alive = false;
    this.clearEffectSprites();
    this.sprite.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    // Undo the run cycle's squash/stretch (onAnimFrameUpdate) — otherwise
    // whichever pose was mid-bounce when the run ended stays
    // squashed/stretched underneath the dance animation.
    this.sprite.setScale(PLAYER_BASE_SCALE, PLAYER_BASE_SCALE);
    this.sprite.play(DANCE_ANIM_KEY);
  }

  // `waiting`: true for a level's very first spawn (tap-to-start gate,
  // held until beginRun() is called) — false for a death-restart, which
  // still auto-runs immediately, preserving the fast retry loop (spec
  // section 6's ~0.3-0.6s death->retry target).
  reset(x: number, y: number, waiting = false): void {
    this.clearEffectSprites();
    // die() hides the real sprite behind the shatter/explosion VFX — undo
    // that here so a retry (or the finish-line freeze() dance) shows the
    // player again.
    this.sprite.setVisible(true);
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
    this.tapWaitMs = null;
    this.tapHeldMs = null;
    this.releaseCutInMs = null;
    this.endSlide();
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
    this.hasShield = false;
    this.shieldProtectionRemainingMs = 0;
    this.speedMultiplier = 1;
    this.speedBoostTimer?.remove();
    this.speedBoostTimer = undefined;
  }

  destroy(): void {
    this.clearEffectSprites();
    this.speedBoostTimer?.remove();
    this.inputSystem.destroy();
    this.scene.events.off(JUMP_DOWN_EVENT, this.onJumpPressed, this);
    this.scene.events.off(JUMP_UP_EVENT, this.onJumpReleased, this);
    this.sprite.off(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      this.onAnimFrameUpdate,
      this
    );
  }

  // Exposed so GameScene can tell whether the very first tap has already
  // landed (e.g. to know when to hide the tap-to-start prompt and start
  // the run timer) without duplicating the "was this the start tap"
  // decision in two places.
  get isWaitingToStart(): boolean {
    return this.waitingToStart;
  }

  clearBufferedInput(): void {
    this.msSinceJumpPressed = Number.POSITIVE_INFINITY;
    this.tapWaitMs = null;
  }

  private onJumpPressed(): void {
    if (!this.scene.sys.isActive() || !this.alive) return;
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
    if (this.tapWaitMs !== null) {
      // Second tap inside the window: slide instead of jumping.
      this.tapWaitMs = null;
      if (this.body.blocked.down) this.startSlide();
      return;
    }
    // Only a tap on the ground (not mid-slide) can start a double-tap.
    // Mid-slide it jumps out right away; in the air it buffers a jump for
    // landing, both exactly as before.
    if (this.body.blocked.down && !this.isSliding) {
      this.tapWaitMs = 0;
      this.tapHeldMs = null;
      return;
    }
    this.msSinceJumpPressed = 0;
  }


  private onJumpReleased(): void {
    if (!this.scene.sys.isActive() || !this.alive) return;
    if (this.tapWaitMs !== null) {
      this.tapHeldMs = this.tapWaitMs;
      return;
    }
    this.cutJump();
  }

  // Hold-to-jump-higher: letting go while still rising cuts the jump short.
  private cutJump(): void {
    if (this.body.velocity.y < 0) {
      this.sprite.setVelocityY(this.body.velocity.y * JUMP_RELEASE_MULTIPLIER);
    }
  }
}
