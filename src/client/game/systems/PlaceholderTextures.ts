import * as Phaser from 'phaser';

// Procedurally generated placeholder art for whatever still has no real
// sprite. Ground/platform/hazard/finish/power-up art now all loads as real
// images in Preloader (see ObjectRegistry) — this only generates the
// generic particle dot, which has no real-art equivalent since every burst
// tints it per-effect at runtime (see Juice.burstParticles).
export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('particle')) {
    return;
  }

  const graphics = scene.add.graphics();

  // A single small dot, reused by every particle burst (death/finish
  // juice, spec section 31) — tinted per-effect via the emitter config
  // rather than baking color into the texture.
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(6, 6, 6);
  graphics.generateTexture('particle', 12, 12);

  graphics.destroy();
}
