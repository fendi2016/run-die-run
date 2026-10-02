import * as Phaser from 'phaser';
import { notorietyTier, type NotorietyTier } from '../../../shared/trapNotoriety';

// Kill-count badges over the traps that have earned one (see
// shared/trapNotoriety.ts): "☠ 112" floating above the trap, bigger and
// redder the deadlier it is, so a level's most dangerous traps are
// recognisable at a glance. Each badge follows its trap (moving saws,
// floaters) and goes away with it. Purely cosmetic — nothing touches a
// body.

const BADGE_GAP_PX = 6;
// Above the traps and death skulls; small enough not to hide the player.
const BADGE_DEPTH = 0.5;

const TIER_STYLE: Record<NotorietyTier, { skulls: string; size: number; color: string }> = {
  1: { skulls: '☠', size: 15, color: '#2b2b2b' },
  2: { skulls: '☠☠', size: 18, color: '#c0392b' },
  3: { skulls: '☠☠☠', size: 22, color: '#c0392b' },
};

export function drawTrapBadges(
  scene: Phaser.Scene,
  traps: ReadonlyMap<string, Phaser.GameObjects.Sprite>,
  trapKills: Record<string, number>
): void {
  for (const [objectId, kills] of Object.entries(trapKills)) {
    const sprite = traps.get(objectId);
    const tier = notorietyTier(kills);
    if (!sprite?.active || tier === undefined) continue;
    attachBadge(scene, sprite, kills, tier);
  }
}

function attachBadge(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  kills: number,
  tier: NotorietyTier
): void {
  const style = TIER_STYLE[tier];
  // Measured once from where the trap was drawn: a spinning saw's bounds
  // change every frame, and the badge shouldn't bob with them.
  const lift = sprite.y - sprite.getBounds().top + BADGE_GAP_PX;
  const badge = scene.add
    .text(sprite.x, sprite.y - lift, `${style.skulls} ${kills.toLocaleString()}`, {
      fontFamily: 'Doodlefont, sans-serif',
      fontSize: `${style.size}px`,
      color: style.color,
      stroke: '#fffdf5',
      strokeThickness: 4,
    })
    .setOrigin(0.5, 1)
    .setDepth(BADGE_DEPTH);
  if (tier === 3) {
    scene.tweens.add({
      targets: badge,
      scale: 1.12,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
  const follow = (): void => {
    badge.setPosition(sprite.x, sprite.y - lift);
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, follow);
  const remove = (): void => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, follow);
    badge.destroy();
  };
  sprite.once(Phaser.GameObjects.Events.DESTROY, remove);
}
