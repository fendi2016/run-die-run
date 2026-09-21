import * as Phaser from 'phaser';

// Cheap, asset-free "juice" (spec section 31: squish/pop/explosion on
// death, celebration on finish) — a one-shot particle burst using the
// shared placeholder dot texture. In a HONK-style punishing platformer,
// death (and thus this burst) fires constantly during a fast retry loop,
// so each scene gets a small pool of reused ParticleEmitter GameObjects
// instead of creating and destroying a new one per burst (the same
// create/destroy-per-effect GC churn Honk's own particle pooling fixed).
const MAX_POOLED_EMITTERS = 4;
const emitterPools = new WeakMap<
  Phaser.Scene,
  Phaser.GameObjects.Particles.ParticleEmitter[]
>();

function getEmitterPool(
  scene: Phaser.Scene
): Phaser.GameObjects.Particles.ParticleEmitter[] {
  let pool = emitterPools.get(scene);
  if (pool) {
    return pool;
  }
  pool = [];
  emitterPools.set(scene, pool);
  // GameScene reuses the same instance across death/retry (restartRun()
  // never recreates it), so the pool lives for the whole punishing retry
  // loop — it only needs tearing down when the scene actually shuts down.
  scene.events.once('shutdown', () => {
    for (const emitter of pool ?? []) {
      emitter.destroy();
    }
    emitterPools.delete(scene);
  });
  return pool;
}

export function burstParticles(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  count = 14
): void {
  const pool = getEmitterPool(scene);
  let emitter = pool.find((candidate) => candidate.getAliveParticleCount() === 0);
  if (!emitter) {
    if (pool.length < MAX_POOLED_EMITTERS) {
      emitter = scene.add.particles(0, 0, 'particle', {
        speed: { min: 80, max: 260 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0 },
        lifespan: 420,
        tint: color,
        emitting: false,
      });
      pool.push(emitter);
    } else {
      // Every pooled emitter is mid-burst (extremely unlikely for a
      // 420ms-lifespan one-shot) — reuse the oldest rather than growing
      // the pool unbounded.
      for (const pooled of pool) {
        emitter = pooled;
        break;
      }
    }
  }
  if (!emitter) {
    return;
  }
  // updateConfig merges into the existing config, so only tint changes —
  // setConfig would reset every other op (speed/angle/scale/lifespan) back
  // to its default since it re-applies the full config it's given.
  emitter.updateConfig({ tint: color });
  emitter.explode(count, x, y);
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
  sprite: Phaser.GameObjects.Sprite,
  color: number,
  outerStrength = 4
): void {
  sprite.enableFilters();
  if (!sprite.filters) {
    return;
  }
  const glow = sprite.filters.internal.addGlow(color, outerStrength);
  glow.setPaddingOverride(null);
}
