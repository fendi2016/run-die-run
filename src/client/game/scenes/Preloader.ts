import { Scene } from 'phaser';
import type * as Phaser from 'phaser';
import { PLAYER_TEXTURE_KEYS } from '../entities/Player';
import { HAZARD_SPRITESHEETS } from '../objects/ObjectRegistry';
import { getRequestedLevelId } from '../levelSelection';
import { prefetchLevel, prefetchSettled } from '../levelPrefetch';
import { SFX_FILES, SFX_KEYS } from '../systems/Sfx';

const BAR_WIDTH = 460;

export class Preloader extends Scene {
  private failed = false;
  constructor() {
    super('Preloader');
  }

  init() {
    this.failed = false;
    // RESIZE mode means `this.scale` is the real device viewport here, not
    // a fixed logical size, so center against it directly.
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const barWidth = Math.max(40, Math.min(BAR_WIDTH, this.scale.width - 48));

    this.cameras.main.setBackgroundColor(0x14141f);

    //  A simple progress bar. This is the outline of the bar.
    this.add
      .rectangle(centerX, centerY, barWidth + 8, 32)
      .setStrokeStyle(1, 0xffffff);

    //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
    const bar = this.add
      .rectangle(centerX - barWidth / 2, centerY, 4, 28, 0xffffff)
      .setOrigin(0, 0.5);

    //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
    const onProgress = (progress: number) => {
      bar.width = Math.max(4, barWidth * progress);
    };
    // Sound is pure polish (see Sfx.ts) and must never be able to block the
    // game from loading — a failed/unsupported audio file only skips that
    // one sound (Phaser just won't have it in its cache; Sfx.playSfx
    // already no-ops safely on a missing key), unlike every other asset
    // type, where a load failure means something actually required is
    // missing and the whole game can't safely start.
    const onError = (file: Phaser.Loader.File) => {
      if (file.type !== 'audio') {
        this.failed = true;
      }
    };
    this.load.on('progress', onProgress);
    this.load.on('loaderror', onError);
    this.events.once('shutdown', () => {
      this.load.off('progress', onProgress);
      this.load.off('loaderror', onError);
    });
  }

  preload() {
    // In parallel with the assets below — see levelPrefetch.ts.
    prefetchLevel(getRequestedLevelId());

    //  Load the assets for the game - Replace with your own assets
    this.load.setPath('../assets');

    // Each player pose is its own named image (see Player.ts for how
    // they're strung into animations/states) rather than one spritesheet —
    // easier to see and swap individual poses than indices into a grid.
    for (const key of PLAYER_TEXTURE_KEYS) {
      this.load.image(key, `player/${key}.webp`);
    }

    // Level object art (see ObjectRegistry for how each ObjectType maps to
    // one of these keys). Sourced from the open-source sprite pack in
    // /sprites, pre-cropped/scaled to the game's tile and hazard sizes.
    this.load.image('ground', 'tiles/ground.webp');
    // Mossy-stone platform tileset (see ObjectRegistry.pickPlatformTexture)
    // — edge/center variants so a run of platform tiles reads as one
    // continuous block instead of one texture tiled flat.
    this.load.image(
      'platform-top-left-edge',
      'tiles/platform/platform-top-left-edge.webp'
    );
    this.load.image(
      'platform-top-right-edge',
      'tiles/platform/platform-top-right-edge.webp'
    );
    for (let i = 1; i <= 7; i++) {
      this.load.image(
        `platform-top-center-${i}`,
        `tiles/platform/platform-top-center-${i}.webp`
      );
    }
    // 8-frame spin animation (see ObjectRegistry.ensureHazardAnims), not a
    // static image, unlike every other level-object texture here.
    this.load.spritesheet('saw-spin', 'hazards/saw-spin.webp', {
      frameWidth: 40,
      frameHeight: 40,
    });
    // Animated 8-frame sheets (see ObjectRegistry.HAZARD_SPRITESHEETS); the
    // single-frame hazards/*.webp next to them are only the editor icons.
    for (const sheet of HAZARD_SPRITESHEETS) {
      this.load.spritesheet(sheet.key, sheet.file, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
    // The finish bell (see ObjectRegistry/Juice.playFinishBellAnimation) is
    // 4 separate frames rather than a spritesheet — each has its own
    // hand-picked origin (FINISH_ORIGIN_X) so the post stays visually
    // planted while the bell/motion-lines/ghosts around it change extent.
    this.load.image('finish-idle', 'markers/finish-idle.webp');
    this.load.image('finish-hit', 'markers/finish-hit.webp');
    this.load.image('finish-ringing', 'markers/finish-ringing.webp');
    this.load.image('finish-success', 'markers/finish-success.webp');
    this.load.image('spawn-marker', 'markers/spawn.webp');
    this.load.image('shield', 'powerups/shield.webp');
    this.load.image('speedBoost', 'powerups/speedBoost.webp');
    this.load.image('level-background', 'ui/scene-bg.webp');

    // Death VFX (see Juice.playDeathExplosion) — sourced from the VFX Free
    // Pack at repo root. death-explosion is a trimmed spritesheet (first 24
    // of the source's 30 frames; the rest fade to nothing and just wasted
    // space) played fast for a "quick" pop rather than its native ~1s
    // runtime. death-kaboom is one hand-picked frame of the pack's
    // (near-static, barely-animated) comic "KABOOM" burst, popped in and
    // faded out with a tween instead of loading all 30 near-duplicate
    // frames.
    this.load.spritesheet('death-explosion', 'vfx/death-explosion.webp', {
      frameWidth: 355,
      frameHeight: 355,
    });
    this.load.image('death-kaboom', 'vfx/death-kaboom.webp');
    // Slide kick-off burst (see Juice.playSlideImpact) — the VFX pack's
    // "Impact" effect, all 14 frames at half its native 291x301.
    this.load.spritesheet('slide-impact', 'vfx/slide-impact.webp', {
      frameWidth: 146,
      frameHeight: 151,
    });
    this.load.spritesheet('slide-dust', 'vfx/slide-dust.webp', {
      frameWidth: 64,
      frameHeight: 64,
    });
    // Saw-death gore (see Juice.playBloodSplatter) — Super Pixel Effects'
    // burst_splatter_001_large_red, all 10 frames.
    this.load.spritesheet('blood-splatter', 'vfx/blood-splatter.webp', {
      frameWidth: 64,
      frameHeight: 64,
    });
    // The rest of the per-hazard death VFX (see DeathEffects), also Super
    // Pixel Effects, each repacked into a single-row strip:
    // blood-spray is directional_splatter_003_large_red, mirrored so it
    // sprays up and back; bat-impact is directional_impact_004_large_yellow;
    // ash-smoke is directional_smoke_burst_001_large_white; ghost-skull-smoke
    // is stylized_skull_smoke_burst_001_large_white.
    this.load.spritesheet('blood-spray', 'vfx/blood-spray.webp', {
      frameWidth: 48,
      frameHeight: 48,
    });
    this.load.spritesheet('bat-impact', 'vfx/bat-impact.webp', {
      frameWidth: 80,
      frameHeight: 80,
    });
    this.load.spritesheet('ash-smoke', 'vfx/ash-smoke.webp', {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet('ghost-skull-smoke', 'vfx/ghost-skull-smoke.webp', {
      frameWidth: 64,
      frameHeight: 64,
    });

    // Power-up VFX (see Juice.attachElectricShield/playHyperspeedTrail),
    // also from the VFX Free Pack. shield-electric is the source pack's
    // full 30-frame loop (a genuine one-revolution rotation, unlike the
    // death VFX above — trimming it would cut the rotation off mid-spin).
    // hyperspeed-lines is trimmed to 18 of its 30 frames (same "no visual
    // loss, just less file" reasoning as death-explosion — the streak
    // pattern has no fade arc to preserve, just cycles).
    this.load.spritesheet('shield-electric', 'vfx/shield-electric.webp', {
      frameWidth: 265,
      frameHeight: 265,
    });
    this.load.spritesheet('hyperspeed-lines', 'vfx/hyperspeed-lines.webp', {
      frameWidth: 517,
      frameHeight: 515,
    });

    // Sound effects (see Sfx.ts) — a failure here never fails the whole
    // load (onError above exempts 'audio' files).
    for (const key of SFX_KEYS) {
      this.load.audio(key, SFX_FILES[key]);
    }
  }

  create() {
    if (this.failed) {
      this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2 + 48,
          'Could not load the game.\nTap to retry.',
          {
            fontSize: '18px',
            align: 'center',
            wordWrap: { width: Math.max(100, this.scale.width - 48) },
          }
        )
        .setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.restart());
      return;
    }
    //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
    //  For example, you can define global animations here, so we can use them in other scenes.

    //  Move to the MainMenu once the level prefetch has also landed (it
    //  normally beats the assets; the cap keeps a slow API from holding the
    //  bar at 100%).
    void prefetchSettled(4000).then(() => this.scene.start('MainMenu'));
  }
}
