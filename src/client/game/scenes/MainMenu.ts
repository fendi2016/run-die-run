import { Scene, GameObjects } from 'phaser';

// Under Phaser's RESIZE scale mode the canvas fills the real device
// viewport edge-to-edge (no letterboxing), so `this.scale` reports actual,
// live dimensions that change on rotation/resize — layout is recomputed
// from scratch on every resize rather than assuming a fixed canvas size.
export class MainMenu extends Scene {
  private background: GameObjects.Image | null = null;
  private logo: GameObjects.Image | null = null;
  private title: GameObjects.Text | null = null;

  constructor() {
    super('MainMenu');
  }

  init(): void {
    this.background = null;
    this.logo = null;
    this.title = null;
  }

  create(): void {
    this.refreshLayout();
    this.scale.on('resize', this.refreshLayout, this);
    this.events.once('shutdown', () =>
      this.scale.off('resize', this.refreshLayout, this)
    );

    this.input.once('pointerdown', () => {
      this.scene.start('GameScene');
    });
  }

  private refreshLayout(): void {
    const { width, height } = this.scale;

    if (!this.background) {
      this.background = this.add.image(0, 0, 'background').setOrigin(0);
    }
    this.background.setPosition(0, 0).setDisplaySize(width, height);

    if (!this.logo) {
      this.logo = this.add.image(0, 0, 'logo');
    }
    this.logo.setPosition(width / 2, height * 0.38);

    if (!this.title) {
      this.title = this.add
        .text(0, 0, 'Tap to Play', {
          fontFamily: 'Arial Black',
          fontSize: '38px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 8,
          align: 'center',
        })
        .setOrigin(0.5);
    }
    this.title.setPosition(width / 2, height * 0.6);
  }
}
