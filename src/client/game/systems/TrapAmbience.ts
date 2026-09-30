import * as Phaser from 'phaser';
import type { LevelObject } from '../../../shared/types';

// All ambience needs of an object: what it is and where it was placed.
type PlacedObject = Pick<LevelObject, 'type' | 'x' | 'y'>;
import {
  STAPLER_SNAP_EVENT,
  ZAPPER_SWITCH_EVENT,
  maceHitboxOf,
} from '../objects/ObjectRegistry';
import { burstParticles, emitSpeedLine, playPixelFx } from './Juice';

// Small looping touches on traps and power-ups, standing in for the motion
// lines the old art had drawn in. Played in runs and on every builder board
// (the editors rebuild their sprites on each edit), purely cosmetic (no
// body is touched), and each one only plays while its object is on screen.
// Everything stops when its object is destroyed.

const INK = 0x2b2b2b;
const STOPWATCH_SPECK = 0x8ec8ff;
const ON_SCREEN_MARGIN_PX = 80;

function onScreen(scene: Phaser.Scene, x: number, y: number): boolean {
  const view = scene.cameras.main.worldView;
  return (
    x > view.x - ON_SCREEN_MARGIN_PX &&
    x < view.right + ON_SCREEN_MARGIN_PX &&
    y > view.y - ON_SCREEN_MARGIN_PX &&
    y < view.bottom + ON_SCREEN_MARGIN_PX
  );
}

// Runs `fire` over and over, a random minMs..maxMs apart, while `owner`
// lives.
function repeatEvery(
  scene: Phaser.Scene,
  owner: Phaser.GameObjects.Sprite,
  minMs: number,
  maxMs: number,
  fire: () => void
): void {
  let timer: Phaser.Time.TimerEvent | undefined;
  const schedule = () => {
    timer = scene.time.delayedCall(Phaser.Math.Between(minMs, maxMs), () => {
      if (!owner.active) return;
      fire();
      schedule();
    });
  };
  schedule();
  owner.once(Phaser.GameObjects.Events.DESTROY, () => timer?.remove());
}

function everyFrame(
  scene: Phaser.Scene,
  owner: Phaser.GameObjects.Sprite,
  tick: (time: number, deltaMs: number) => void
): void {
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  owner.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
}

function isShowing(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite): boolean {
  const center = sprite.getCenter();
  return sprite.visible && onScreen(scene, center.x, center.y);
}

function glint(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, x: number, y: number): void {
  playPixelFx(scene, 'trap-glint', x, y, { scale: 0.45, depth: sprite.depth + 0.1 });
}

// Call right after renderLevelObject (and motionTweenConfigFor's tween)
// for any object; types without ambience are ignored.
export function attachAmbience(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  object: PlacedObject
): void {
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(sprite));
  attachTrapAmbience(scene, sprite, object);
  attachPowerUpAmbience(scene, sprite, object);
}

function attachTrapAmbience(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  object: PlacedObject
): void {
  switch (object.type) {
    case 'spikes':
    case 'ceilingSpikes': {
      // Tips point up on floor spikes, down on ceiling spikes.
      const tipY = object.type === 'spikes' ? 0.8 : 0.12;
      repeatEvery(scene, sprite, 1800, 3600, () => {
        if (!isShowing(scene, sprite)) return;
        glint(
          scene,
          sprite,
          sprite.x + (Math.random() - 0.5) * 0.7 * sprite.displayWidth,
          sprite.y - sprite.displayHeight * tipY
        );
      });
      break;
    }
    case 'spikeMine': {
      repeatEvery(scene, sprite, 1800, 3600, () => {
        if (!isShowing(scene, sprite)) return;
        const angle = Math.random() * Math.PI * 2;
        const radius = sprite.displayHeight * 0.42;
        const center = sprite.getCenter();
        glint(scene, sprite, center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
      });
      // A nervous twitch now and then.
      repeatEvery(scene, sprite, 2200, 4200, () => {
        if (!isShowing(scene, sprite)) return;
        scene.tweens.add({
          targets: sprite,
          angle: { from: -7, to: 7 },
          duration: 60,
          yoyo: true,
          repeat: 1,
          onComplete: () => sprite.setAngle(0),
        });
      });
      break;
    }
    case 'saw':
    case 'movingSaw': {
      // Sparks off the bottom of the blade, where it grinds.
      repeatEvery(scene, sprite, 380, 700, () => {
        if (!isShowing(scene, sprite)) return;
        playPixelFx(scene, 'saw-sparks', sprite.x, sprite.y + sprite.displayHeight / 2, {
          scale: 0.5,
          originY: 0.7,
          depth: sprite.depth + 0.1,
        });
      });
      break;
    }
    case 'electricMine': {
      // Crackles only while it's on (see ObjectRegistry's Zapper cycle).
      const center = sprite.getCenter();
      const crackle = scene.add
        .sprite(center.x, center.y, 'zapper-crackle')
        .setScale(0.75)
        .setDepth(sprite.depth - 0.01);
      crackle.play({ key: 'zapper-crackle', randomFrame: true });
      sprite.on(ZAPPER_SWITCH_EVENT, (on: boolean) => {
        crackle.setVisible(on);
        if (on && isShowing(scene, sprite)) {
          playPixelFx(scene, 'saw-sparks', center.x, center.y, { scale: 0.7, depth: sprite.depth + 0.1 });
        }
      });
      sprite.once(Phaser.GameObjects.Events.DESTROY, () => crackle.destroy());
      break;
    }
    case 'mace': {
      // An ink streak behind the ball through the fast bottom of the swing.
      const ball = maceHitboxOf(sprite);
      if (!ball) break;
      let lastX = ball.x;
      let lastY = ball.y;
      let everyOther = false;
      everyFrame(scene, sprite, (_time, deltaMs) => {
        const speed = (Math.hypot(ball.x - lastX, ball.y - lastY) / Math.max(deltaMs, 1)) * 1000;
        everyOther = !everyOther;
        if (everyOther && speed > 170 && onScreen(scene, ball.x, ball.y)) {
          const streak = scene.add.graphics().setName('mace-streak').setDepth(sprite.depth - 0.02);
          streak.lineStyle(3, INK, 0.45);
          streak.lineBetween(lastX, lastY, ball.x, ball.y);
          scene.tweens.add({
            targets: streak,
            alpha: 0,
            duration: 180,
            onComplete: () => streak.destroy(),
          });
        }
        lastX = ball.x;
        lastY = ball.y;
      });
      break;
    }
    case 'candle': {
      // Ink flecks from the mouth (on the left) as it snaps shut.
      sprite.on(STAPLER_SNAP_EVENT, () => {
        if (!isShowing(scene, sprite)) return;
        burstParticles(
          scene,
          sprite.x - sprite.displayWidth * 0.3,
          sprite.y - sprite.displayHeight * 0.45,
          INK,
          4
        );
      });
      break;
    }
    default:
      break;
  }
}

function attachPowerUpAmbience(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  object: PlacedObject
): void {
  switch (object.type) {
    case 'wings': {
      // Floats, flapping. The float shifts the drawing, not the sprite, so
      // it never fights a drag in the curse builder.
      scene.tweens.add({
        targets: sprite,
        displayOriginY: sprite.displayOriginY + 4 / sprite.scaleY,
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      scene.tweens.add({
        targets: sprite,
        scaleX: sprite.scaleX * 0.82,
        duration: 140,
        yoyo: true,
        repeat: -1,
        repeatDelay: 500,
        ease: 'Quad.easeInOut',
      });
      break;
    }
    case 'speedBoost': {
      // Speed lines off the back of the shoe.
      repeatEvery(scene, sprite, 90, 140, () => {
        if (!isShowing(scene, sprite)) return;
        emitSpeedLine(
          scene,
          sprite.x - sprite.displayWidth * 0.45,
          sprite.y - sprite.displayHeight * (0.25 + Math.random() * 0.5)
        );
      });
      break;
    }
    case 'stopwatch': {
      // Ticks once a second, with pale-blue specks circling it.
      repeatEvery(scene, sprite, 1000, 1000, () => {
        if (!isShowing(scene, sprite)) return;
        scene.tweens.add({ targets: sprite, angle: 9, duration: 70, yoyo: true });
      });
      const specks = [0, 1, 2].map(() => scene.add.circle(sprite.x, sprite.y, 2.5, STOPWATCH_SPECK));
      everyFrame(scene, sprite, (time) => {
        const center = sprite.getCenter();
        const radius = sprite.displayHeight * 0.62;
        specks.forEach((speck, i) => {
          const angle = (time / 2400) * Math.PI * 2 + (i * Math.PI * 2) / 3;
          speck
            .setPosition(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius * 0.45)
            .setDepth(sprite.depth + (Math.sin(angle) > 0 ? 0.1 : -0.1))
            .setVisible(sprite.visible);
        });
      });
      sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
        for (const speck of specks) speck.destroy();
      });
      break;
    }
    case 'shield': {
      // A glint sweeping across its face.
      repeatEvery(scene, sprite, 2400, 4000, () => {
        if (!isShowing(scene, sprite)) return;
        const center = sprite.getCenter();
        const reach = sprite.displayWidth * 0.25;
        const sweep = scene.add
          .sprite(center.x - reach, center.y - sprite.displayHeight * 0.15, 'trap-glint')
          .setScale(0.5)
          .setDepth(sprite.depth + 0.1);
        sweep.play('trap-glint');
        sweep.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sweep.destroy());
        scene.tweens.add({ targets: sweep, x: center.x + reach, duration: 350 });
      });
      break;
    }
    default:
      break;
  }
}
