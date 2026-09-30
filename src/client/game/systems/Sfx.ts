import type * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';

// Picked from the 400 Sounds Pack (see public/assets/sfx/), each trimmed so
// the sound starts on its first audible sample — dead air at the front of a
// jump sound reads as input lag — then downmixed to mono 22kHz WAV.
// WAV rather than AAC for anything tied to an input: AAC's encoder priming
// adds ~45ms of silence at the start. Only the level-clear jingle (long,
// and not timing-critical) ships as .m4a.
//   jump   Other/whoosh_1
//   death  Combat and Gore/crunch_splat
//   deathFire  Combat Sounds/fire_punch_02 (candle deaths)
//   deathSaw   Combat Sounds/guts_and_gore_59 (saw deaths)
//   deathSpikes   Combat Sounds/bone_breaking_03
//   deathCeiling  Combat Sounds/bone_breaking_53
//   deathMine     400 Sounds Pack Retro/explosion_medium
//   deathZap      400 Sounds Pack Machines/razor_buzz (cut to 0.7s)
//   deathMace     Combat Sounds/metal_punch_finisher_07
//   deathCrush    Combat Sounds/body_hit_finisher_42
// Newer ones are converted with tools/pack-sfx.py.
//   clear  Musical Effects/music_box_level_complete
//   pickup Items/gem_collect
export const SFX_KEYS = [
  'jump',
  'death',
  'deathFire',
  'deathSaw',
  'deathSpikes',
  'deathCeiling',
  'deathMine',
  'deathZap',
  'deathMace',
  'deathCrush',
  'clear',
  'pickup',
] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

export const SFX_FILES: Record<SfxKey, string> = {
  jump: 'sfx/jump.wav',
  death: 'sfx/death.wav',
  deathFire: 'sfx/death_fire.wav',
  deathSaw: 'sfx/death_saw.wav',
  deathSpikes: 'sfx/death_spikes.wav',
  deathCeiling: 'sfx/death_ceiling.wav',
  deathMine: 'sfx/death_mine.wav',
  deathZap: 'sfx/death_zap.wav',
  deathMace: 'sfx/death_mace.wav',
  deathCrush: 'sfx/death_crush.wav',
  clear: 'sfx/clear.m4a',
  pickup: 'sfx/pickup.wav',
};

// Hazards with their own death sound; anything else (and falls) gets the
// generic 'death' crunch. Mirrors DeathEffects' per-hazard VFX map.
export const DEATH_SFX_BY_TYPE: Partial<Record<ObjectType, SfxKey>> = {
  saw: 'deathSaw',
  movingSaw: 'deathSaw',
  candle: 'deathFire',
  spikes: 'deathSpikes',
  ceilingSpikes: 'deathCeiling',
  spikeMine: 'deathMine',
  electricMine: 'deathZap',
  mace: 'deathMace',
  crusher: 'deathCrush',
};

// Every file is normalized to the same peak, so these set the mix.
const VOLUME: Record<SfxKey, number> = {
  jump: 0.3,
  death: 0.5,
  deathFire: 0.5,
  deathSaw: 0.5,
  deathSpikes: 0.5,
  deathCeiling: 0.5,
  deathMine: 0.45,
  deathZap: 0.4,
  deathMace: 0.5,
  deathCrush: 0.5,
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
