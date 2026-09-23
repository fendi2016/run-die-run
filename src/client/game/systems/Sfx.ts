import type * as Phaser from 'phaser';

// Short, procedurally-synthesized chiptune-style blips (see
// public/assets/sfx/*.wav) rather than licensed/recorded sound effects —
// this repo had zero audio before and fabricating "real" sound design
// isn't something to guess at. These are small, tasteful placeholders,
// swappable for real SFX the same way sprites get reskinned: drop a
// replacement file at the same path.
export const SFX_KEYS = ['jump', 'death', 'clear', 'pickup'] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

const VOLUME: Record<SfxKey, number> = {
  jump: 0.35,
  death: 0.45,
  clear: 0.5,
  pickup: 0.4,
};

// Never allowed to throw — sound is pure polish (spec Phase 10), and a
// missing/locked/failed audio context must never break gameplay, least of
// all the fast death->restart loop (spec section 30/rule 30: no network
// calls or blocking failures anywhere in that path).
export function playSfx(scene: Phaser.Scene, key: SfxKey): void {
  try {
    scene.sound.play(key, { volume: VOLUME[key] });
  } catch {
    // Best-effort only.
  }
}
