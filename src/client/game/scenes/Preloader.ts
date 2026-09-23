import { Scene } from 'phaser';
import { PLAYER_TEXTURE_KEYS } from '../entities/Player';

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
    const onError = () => {
      this.failed = true;
    };
    this.load.on('progress', onProgress);
    this.load.on('loaderror', onError);
    this.events.once('shutdown', () => {
      this.load.off('progress', onProgress);
      this.load.off('loaderror', onError);
    });
  }

  preload() {
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
    this.load.image('spike', 'hazards/spike.webp');
    // 8-frame spin animation (see ObjectRegistry.ensureHazardAnims), not a
    // static image, unlike every other level-object texture here.
    this.load.spritesheet('saw-spin', 'hazards/saw-spin.webp', {
      frameWidth: 40,
      frameHeight: 40,
    });
    this.load.image('candle', 'hazards/candle.webp');
    this.load.image('bat', 'hazards/bat.webp');
    this.load.image('ghost', 'hazards/ghost.webp');
    // The finish bell (see ObjectRegistry/Juice.playFinishBellAnimation) is
    // 4 separate frames rather than a spritesheet — each has its own
    // hand-picked origin (FINISH_ORIGIN_X) so the post stays visually
    // planted while the bell/motion-lines/ghosts around it change extent.
    this.load.image('finish-idle', 'markers/finish-idle.webp');
    this.load.image('finish-hit', 'markers/finish-hit.webp');
    this.load.image('finish-ringing', 'markers/finish-ringing.webp');
    this.load.image('finish-success', 'markers/finish-success.webp');
    this.load.image('spawn-marker', 'markers/spawn.webp');
    this.load.image('doubleJump', 'powerups/doubleJump.webp');
    this.load.image('shield', 'powerups/shield.webp');
    this.load.image('speedBoost', 'powerups/speedBoost.webp');
    this.load.image('slowTime', 'powerups/slowTime.webp');
    this.load.image('autoDash', 'powerups/autoDash.webp');
    this.load.image('level-background', 'ui/scene-bg.webp');
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

    //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
    this.scene.start('MainMenu');
  }
}
