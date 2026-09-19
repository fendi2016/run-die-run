import { Scene, GameObjects } from 'phaser';

// Under Phaser's RESIZE scale mode the canvas fills the real device
// viewport edge-to-edge (no letterboxing), so `this.scale` reports actual,
// live dimensions that change on rotation/resize — layout is recomputed
// from scratch on every resize rather than assuming a fixed canvas size.
export class MainMenu extends Scene {
  private background: GameObjects.Image | null = null;
  private logo: GameObjects.Image | null = null;
  private playButton: GameObjects.Text | null = null;
  private createButton: GameObjects.Text | null = null;

  private browseButton: GameObjects.Text | null = null;

  constructor() {
    super('MainMenu');
  }

  init(): void {
    this.background = null;
    this.logo = null;
    this.playButton = null;
    this.createButton = null;
    this.browseButton = null;
  }

  create(): void {
    this.refreshLayout();
    this.scale.on('resize', this.refreshLayout, this);
    this.events.once('shutdown', () =>
      this.scale.off('resize', this.refreshLayout, this)
    );
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
    this.logo.setPosition(width / 2, height * 0.32);

    if (!this.playButton) {
      this.playButton = this.add
        .text(0, 0, 'PLAY', {
          fontFamily: 'Arial Black',
          fontSize: '38px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 8,
          align: 'center',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      this.playButton.on('pointerup', () => this.scene.start('GameScene'));
    }
    this.playButton.setPosition(width / 2, height * 0.52);

    if (!this.createButton) {
      this.createButton = this.add
        .text(0, 0, 'CREATE LEVEL', {
          fontFamily: 'Arial Black',
          fontSize: '22px',
          color: '#39ff88',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      this.createButton.on('pointerup', () => this.scene.start('EditorScene'));
    }
    this.createButton.setPosition(width / 2, height * 0.64);
    if (!this.browseButton) {
      this.browseButton = this.add
        .text(0, 0, 'BROWSE', {
          fontFamily: 'Arial Black',
          fontSize: '22px',
          color: '#39ff88',
          stroke: '#000000',
          strokeThickness: 6,
          align: 'center',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      this.browseButton.on('pointerup', () => void this.openDiscoveryScene());
    }
    this.browseButton.setPosition(width / 2, height * 0.76);
  }

  // DiscoveryScene and its rexUI dependency (~50 components for one
  // GridTable) are deliberately absent from game.ts's static scene/plugin
  // config — dynamically imported here instead, on first BROWSE click, so
  // every other player never downloads them. `installScenePlugin` with no
  // `addToScene` just registers rexUI for the PluginManager to
  // auto-inject into DiscoveryScene when it boots, same as a static
  // `plugins.scene` entry would.
  private loadingDiscovery = false;

  private async openDiscoveryScene(): Promise<void> {
    if (this.scene.get('DiscoveryScene')) {
      this.scene.start('DiscoveryScene');
      return;
    }
    if (this.loadingDiscovery) {
      return;
    }
    this.loadingDiscovery = true;
    try {
      const [{ DiscoveryScene }, uiPluginModule] = await Promise.all([
        import('./DiscoveryScene'),
        import('phaser4-rex-plugins/templates/ui/ui-plugin.js'),
      ]);
      this.plugins.installScenePlugin(
        'rexUI',
        uiPluginModule.default,
        'rexUI',
        undefined,
        true
      );
      // `autoStart: true` here would boot DiscoveryScene without stopping
      // MainMenu (unlike `scene.start()`, which stops the caller) — both
      // scenes would then run concurrently, leaving MainMenu's buttons
      // interactive and visually stacked underneath DiscoveryScene. Add
      // it inactive, then start it the same way the repeat-click path
      // (`this.scene.get(...)` above) already does.
      this.scene.add('DiscoveryScene', DiscoveryScene, false);
      this.scene.start('DiscoveryScene');
    } finally {
      this.loadingDiscovery = false;
    }
  }
}
