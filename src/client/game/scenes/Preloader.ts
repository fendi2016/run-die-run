import { SCRIBBLE_FX } from '../systems/DeathEffects';
import { Scene, type Loader } from 'phaser';
import { PLAYER_TEXTURE_KEYS } from '../entities/Player';
import {
  createSpawnIconTexture,
  HAZARD_SPRITESHEETS,
  TERRAIN_TEXTURE_FILES,
} from '../objects/ObjectRegistry';
import { getRequestedLevelId } from '../levelSelection';
import { prefetchLevel } from '../levelPrefetch';
import { prefetchCurseReveal } from '../../ui/CurseReveal';
import { streamSfx } from '../systems/Sfx';
import { createPixelFxAnims, PIXEL_FX_SHEETS, streamLateSpritesheets } from '../systems/Juice';
import { SCENERY_ART } from '../systems/PaperScenery';
import { allowMusic } from '../../ui/SoundToggle';
import { deviceKind, sendAnalyticsEvent } from '../../analytics';

const BAR_WIDTH = 460;

// One quiet automatic retry before asking the player to tap: a dropped
// request on a flaky connection usually succeeds on the next try, and
// files already loaded are kept, so a retry only fetches what's missing.
const AUTO_RETRIES = 1;
let retriesUsed = 0;
// When this load (or its first try) began, ms from page start.
let assetsStartMs: number | undefined;

// When the game's own code finished downloading, ms from page start.
function codeDownloadedMs(): number | undefined {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!src) return undefined;
  const entry = performance.getEntriesByName(src)[0];
  return entry instanceof PerformanceResourceTiming ? Math.round(entry.responseEnd) : undefined;
}

export class Preloader extends Scene {
  private failed = false;
  private failedFile: string | undefined;
  constructor() {
    super('Preloader');
  }

  init() {
    this.failed = false;
    this.failedFile = undefined;
    assetsStartMs ??= Math.round(performance.now());
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
    // Every file here is required (sounds stream in later, see
    // Sfx.streamSfx), so any load failure means the game can't safely start.
    const onError = (file: Loader.File) => {
      this.failed = true;
      this.failedFile ??= file.key;
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
    prefetchCurseReveal();

    //  Load the assets for the game - Replace with your own assets
    this.load.setPath('../assets');

    // Each player pose is its own named image (see Player.ts for how
    // they're strung into animations/states) rather than one spritesheet —
    // easier to see and swap individual poses than indices into a grid.
    for (const key of PLAYER_TEXTURE_KEYS) {
      this.load.image(key, `player/${key}.webp`);
    }
    // The clear-screen dive into the sharpener (Juice.playSharpenerDive),
    // from the user's diving.png.
    this.load.image('player-dive', 'player/player-dive.webp');

    // Level object art (see ObjectRegistry for how each ObjectType maps to
    // one of these keys). Sourced from the open-source sprite pack in
    // /sprites, pre-cropped/scaled to the game's tile and hazard sizes.
    // Terrain art from the "level sprites" sheet: every tileset in
    // ObjectRegistry's TERRAIN_TILESETS (end caps, centers, standalone
    // pieces), listed there once.
    for (const { key, file } of TERRAIN_TEXTURE_FILES) this.load.image(key, file);
    // A single sawblade image, spun by angle (ObjectRegistry) instead of the
    // old 8-frame sheet. Drawn at SAW_DISPLAY_SIZE_PX (the old 40x40), so
    // the saw/movingSaw hitbox is unchanged.
    this.load.image('saw-spin', 'hazards/saw-spin.webp');
    // Traps from the scribble traps sheet (see ObjectRegistry).
    this.load.image('candle', 'hazards/stapler.webp');
    this.load.image('ceiling-spikes', 'hazards/ceiling-spikes.webp');
    this.load.image('spike-mine', 'hazards/spike-mine.webp');
    this.load.image('electric-mine', 'hazards/electric-mine.webp');
    this.load.image('mace-swing', 'hazards/mace-swing.webp');
    this.load.image('mace-beam', 'hazards/mace-beam.webp');
    // Animated 8-frame sheets (see ObjectRegistry.HAZARD_SPRITESHEETS); the
    // single-frame hazards/*.webp next to them are only the editor icons.
    for (const sheet of HAZARD_SPRITESHEETS) {
      this.load.spritesheet(sheet.key, sheet.file, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
    // The finish sharpener (see Juice.playSharpenerDive) and the spawn
    // pencil case are single frames; their effects come from PIXEL_FX_SHEETS.
    this.load.image('finish-gate', 'markers/finish.webp');
    this.load.image('spawn-marker', 'markers/spawn.webp');
    this.load.image('shield', 'powerups/shield.webp');
    this.load.image('speedBoost', 'powerups/speedBoost.webp');
    this.load.image('wings', 'powerups/wings.webp');
    this.load.image('stopwatch', 'powerups/stopwatch.webp');
    this.load.image('level-background', 'ui/paper-bg.webp');
    // Background-art scenery (see PaperScenery.drawScenery).
    for (const { key, file } of SCENERY_ART) this.load.image(key, file);

    this.load.image('spikes', 'hazards/spikes.webp');
    // Scribble death art (see DeathEffects.SCRIBBLE_FX).
    for (const { key, file } of SCRIBBLE_FX) this.load.image(key, file);

    // Effect strips (see Juice.PIXEL_FX_SHEETS). The death fireball and
    // the Shield's electric ring stream in after this bar instead (see
    // Juice.streamLateSpritesheets).
    this.load.image('death-kaboom', 'vfx/death-kaboom.webp');
    for (const { key, frameWidth, frameHeight } of PIXEL_FX_SHEETS) {
      this.load.spritesheet(key, `vfx/${key}.webp`, { frameWidth, frameHeight });
    }

    // Kenney UI pieces (CC0 kenney_scribble-platformer pack, PNG/Retina
    // sources converted to lossless webp in public/assets/kenney/ui). Only
    // the pieces actually drawn on the Phaser canvas belong here — the
    // speech-bubble/pan-arrow/digit art (tasks elsewhere in this pass) is
    // plain DOM/CSS and loads via its own <img src>/background-image, not
    // this loader.
    this.load.image('ui-hand', 'kenney/ui/ui-hand.webp');
    this.load.image('ui-select', 'kenney/ui/ui-select.webp');
  }

  create() {
    if (this.failed && retriesUsed < AUTO_RETRIES) {
      retriesUsed++;
      this.time.delayedCall(1000, () => this.scene.restart());
      return;
    }
    if (this.failed) {
      sendAnalyticsEvent({
        event: 'loadFailed',
        ...(this.failedFile
          ? { file: this.failedFile.replace(/[^\w./-]/g, '_').slice(0, 80) }
          : {}),
      });
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
    createPixelFxAnims(this);
    createSpawnIconTexture(this);
    allowMusic();
    streamLateSpritesheets(this.game);
    streamSfx(this.game);

    const codeMs = codeDownloadedMs();
    sendAnalyticsEvent({
      event: 'open',
      device: deviceKind(),
      loadMs: Math.round(performance.now()),
      ...(codeMs !== undefined && assetsStartMs !== undefined && codeMs <= assetsStartMs
        ? { codeMs, assetsStartMs }
        : {}),
    });
    // The menu needs none of the level, so it doesn't wait for the level
    // prefetch: GameScene takes it whenever it lands (see levelPrefetch.ts).
    this.scene.start('MainMenu');
  }
}
