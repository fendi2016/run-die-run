import { Scene } from 'phaser';
import { PLAYER_TEXTURE_KEYS } from '../entities/Player';

const BAR_WIDTH = 460;

export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    // RESIZE mode means `this.scale` is the real device viewport here, not
    // a fixed logical size, so center against it directly.
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    this.cameras.main.setBackgroundColor(0x14141f);

    //  A simple progress bar. This is the outline of the bar.
    this.add
      .rectangle(centerX, centerY, BAR_WIDTH + 8, 32)
      .setStrokeStyle(1, 0xffffff);

    //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
    const bar = this.add.rectangle(
      centerX - BAR_WIDTH / 2,
      centerY,
      4,
      28,
      0xffffff
    );

    //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
    this.load.on('progress', (progress: number) => {
      bar.width = 4 + BAR_WIDTH * progress;
    });
  }

  preload() {
    //  Load the assets for the game - Replace with your own assets
    this.load.setPath('../assets');

    // Each player pose is its own named image (see Player.ts for how
    // they're strung into animations/states) rather than one spritesheet —
    // easier to see and swap individual poses than indices into a grid.
    for (const key of PLAYER_TEXTURE_KEYS) {
      this.load.image(key, `player/${key}.png`);
    }

    // Level object art (see ObjectRegistry for how each ObjectType maps to
    // one of these keys). Sourced from the open-source sprite pack in
    // /sprites, pre-cropped/scaled to the game's tile and hazard sizes.
    this.load.image('ground', 'tiles/ground.png');
    this.load.image('platform', 'tiles/platform.png');
    this.load.image('spike', 'hazards/spike.png');
    // 8-frame spin animation (see ObjectRegistry.ensureHazardAnims), not a
    // static image, unlike every other level-object texture here.
    this.load.spritesheet('saw-spin', 'hazards/saw-spin.png', {
      frameWidth: 40,
      frameHeight: 40,
    });
    this.load.image('finish', 'markers/finish.png');
    this.load.image('spawn-marker', 'markers/spawn.png');
    this.load.image('doubleJump', 'powerups/doubleJump.png');
    this.load.image('shield', 'powerups/shield.png');
    this.load.image('speedBoost', 'powerups/speedBoost.png');
    this.load.image('slowTime', 'powerups/slowTime.png');
    this.load.image('autoDash', 'powerups/autoDash.png');
  }

  create() {
    //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
    //  For example, you can define global animations here, so we can use them in other scenes.

    //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
    this.scene.start('MainMenu');
  }
}
