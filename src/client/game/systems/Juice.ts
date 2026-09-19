import * as Phaser from 'phaser';

// Cheap, asset-free "juice" (spec section 31: squish/pop/explosion on
// death, celebration on finish) — a one-shot particle burst using the
// shared placeholder dot texture, self-destroying once its particles are
// spent rather than lingering as an idle emitter.
export function burstParticles(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  count = 14
): void {
  const emitter = scene.add.particles(x, y, 'particle', {
    speed: { min: 80, max: 260 },
    angle: { min: 0, max: 360 },
    scale: { start: 1, end: 0 },
    lifespan: 420,
    tint: color,
    emitting: false,
  });
  emitter.explode(count, x, y);
  scene.time.delayedCall(500, () => emitter.destroy());
}

// A persistent glow around an object that should read as "important" at a
// glance — the finish portal and power-up pickups (placeholder art alone
// doesn't make either stand out much against the ground/hazard palette).
// Uses Phaser 4's own built-in Filters.Glow (WebGL-only, same as every
// other shader-based approach here) instead of a third-party plugin —
// `sprite.enableFilters()` + `filters.internal.addGlow()` is the engine's
// own documented pattern for exactly this. `setPaddingOverride(null)` lets
// the filter auto-expand its framebuffer so the glow isn't clipped at the
// object's original bounds. No-ops rather than throwing if filters aren't
// available (e.g. a Canvas-only fallback), since this is pure polish and
// must never be able to break level loading.
export function applyOutlineGlow(
  image: Phaser.GameObjects.Image,
  color: number,
  outerStrength = 4
): void {
  image.enableFilters();
  if (!image.filters) {
    return;
  }
  const glow = image.filters.internal.addGlow(color, outerStrength);
  glow.setPaddingOverride(null);
}
