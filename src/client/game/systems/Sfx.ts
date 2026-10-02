import * as Phaser from 'phaser';
import type { ObjectType } from '../../../shared/types';

// Picked from the 400 Sounds Pack (see public/assets/sfx/), each trimmed so
// the sound starts on its first audible sample — dead air at the front of a
// jump sound reads as input lag — then downmixed to mono 22kHz and encoded
// as AAC (.m4a, ~5x smaller than WAV). Apple's encoder records its priming
// samples and browsers trim them on decode (measured: same onset and
// length as the WAVs). Only the jump, the one sound fired by a key press,
// stays WAV, just in case.
//   jump   Other/whoosh_1
//   death  Combat and Gore/crunch_splat
//   deathStaple    400 Sounds Pack Materials/cork_stabbed (stapler deaths)
//   deathSaw   Combat Sounds/guts_and_gore_59 (saw deaths)
//   deathSpikes   Combat Sounds/bone_breaking_03
//   deathCeiling  Combat Sounds/bone_breaking_53
//   deathMine     400 Sounds Pack Retro/explosion_medium
//   deathZap      400 Sounds Pack Machines/razor_buzz (cut to 0.7s)
//   deathMace     Combat Sounds/metal_punch_finisher_07
//   sharpenGrind   400 Sounds Pack Machines/drill_whizz (cut to 1.3s)
//   sharpenSquelch 400 Sounds Pack Combat and Gore/squelching_2 (cut to 0.6s)
//   sharpenTwang   400 Sounds Pack Other/elastic_twang
//   spawnPop       400 Sounds Pack UI/pop_2 (climbing out of the pencil case)
// Converted with tools/pack-sfx.py.
//   clear  Musical Effects/music_box_level_complete
//   pickup Items/gem_collect
export const SFX_KEYS = [
  'jump',
  'death',
  'deathStaple',
  'deathSaw',
  'deathSpikes',
  'deathCeiling',
  'deathMine',
  'deathZap',
  'deathMace',
  'sharpenGrind',
  'sharpenSquelch',
  'sharpenTwang',
  'spawnPop',
  'clear',
  'pickup',
] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

export const SFX_FILES: Record<SfxKey, string> = {
  jump: 'sfx/jump.wav',
  death: 'sfx/death.m4a',
  deathStaple: 'sfx/death_staple.m4a',
  deathSaw: 'sfx/death_saw.m4a',
  deathSpikes: 'sfx/death_spikes.m4a',
  deathCeiling: 'sfx/death_ceiling.m4a',
  deathMine: 'sfx/death_mine.m4a',
  deathZap: 'sfx/death_zap.m4a',
  deathMace: 'sfx/death_mace.m4a',
  sharpenGrind: 'sfx/sharpen_grind.m4a',
  sharpenSquelch: 'sfx/sharpen_squelch.m4a',
  sharpenTwang: 'sfx/sharpen_twang.m4a',
  spawnPop: 'sfx/spawn_pop.m4a',
  clear: 'sfx/clear.m4a',
  pickup: 'sfx/pickup.m4a',
};

// Hazards with their own death sound; anything else (and falls) gets the
// generic 'death' crunch. Mirrors DeathEffects' per-hazard VFX map.
export const DEATH_SFX_BY_TYPE: Partial<Record<ObjectType, SfxKey>> = {
  saw: 'deathSaw',
  movingSaw: 'deathSaw',
  candle: 'deathStaple',
  spikes: 'deathSpikes',
  ceilingSpikes: 'deathCeiling',
  spikeMine: 'deathMine',
  electricMine: 'deathZap',
  mace: 'deathMace',
};

// Every file is normalized to the same peak, so these set the mix.
const VOLUME: Record<SfxKey, number> = {
  jump: 0.3,
  death: 0.5,
  deathStaple: 0.55,
  deathSaw: 0.5,
  deathSpikes: 0.5,
  deathCeiling: 0.5,
  deathMine: 0.45,
  deathZap: 0.4,
  deathMace: 0.5,
  sharpenGrind: 0.35,
  sharpenSquelch: 0.5,
  sharpenTwang: 0.45,
  spawnPop: 0.45,
  clear: 0.45,
  pickup: 0.35,
};

const STREAM_RETRY_MS = 3000;
let streamStarted = false;

// Sounds aren't in the Preloader: they're polish, so they download behind
// the menu instead of lengthening the loading bar (like Juice's streamed
// spritesheets). Until one lands, playSfx for it is silently skipped.
// Without Web Audio (rare) there's no decoder to hand them to, so the game
// stays silent, as it would anyway.
export function streamSfx(game: Phaser.Game): void {
  if (streamStarted) return;
  streamStarted = true;
  const sound = game.sound;
  if (!(sound instanceof Phaser.Sound.WebAudioSoundManager)) return;
  for (const key of SFX_KEYS) {
    const load = (retries: number): void => {
      // Relative to game.html, like the Preloader's '../assets' path.
      fetch(`../assets/${SFX_FILES[key]}`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => {
          if (!game.cache.audio.exists(key)) sound.decodeAudio(key, data);
        })
        .catch(() => {
          if (retries > 0) setTimeout(() => load(retries - 1), STREAM_RETRY_MS);
        });
    };
    load(2);
  }
}

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
