import type * as Phaser from 'phaser';

// Picked from the 400 Sounds Pack (see public/assets/sfx/), each trimmed so
// the sound starts on its first audible sample — dead air at the front of a
// jump/slide sound reads as input lag — then downmixed to mono 22kHz WAV.
// WAV rather than AAC for anything tied to an input: AAC's encoder priming
// adds ~45ms of silence at the start. Only the level-clear jingle (long,
// and not timing-critical) ships as .m4a.
//   jump   Other/whoosh_1
//   slide  Materials/concrete_scrape (first 0.5s)
//   death  Combat and Gore/crunch_splat
//   deathFire  Combat Sounds/fire_punch_02 (candle deaths)
//   clear  Musical Effects/music_box_level_complete
//   pickup Items/gem_collect
export const SFX_KEYS = ['jump', 'slide', 'death', 'deathFire', 'clear', 'pickup'] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

export const SFX_FILES: Record<SfxKey, string> = {
  jump: 'sfx/jump.wav',
  slide: 'sfx/slide.wav',
  death: 'sfx/death.wav',
  deathFire: 'sfx/death_fire.wav',
  clear: 'sfx/clear.m4a',
  pickup: 'sfx/pickup.wav',
};

// Every file is normalized to the same peak, so these set the mix.
const VOLUME: Record<SfxKey, number> = {
  jump: 0.3,
  slide: 0.35,
  death: 0.5,
  deathFire: 0.5,
  clear: 0.45,
  pickup: 0.35,
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
