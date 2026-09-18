import { Scene } from 'phaser';

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

    //  We loaded this image in our Boot Scene, so we can display it here
    this.add.image(centerX, centerY, 'background');

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

    this.load.image('logo', 'logo.png');
  }

  create() {
    //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
    //  For example, you can define global animations here, so we can use them in other scenes.

    //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
    this.scene.start('MainMenu');
  }
}
