import { Scene, GameObjects } from 'phaser';
import { SPLASH_AUTOSTART_KEY } from '../../../shared/constants';
import { ensureHazardAnims } from '../objects/ObjectRegistry';

const FLOOR_HEIGHT = 60;
const SPIKE_ROW_HEIGHT = 34;

// Under Phaser's RESIZE scale mode the canvas fills the real device
// viewport edge-to-edge (no letterboxing), so `this.scale` reports actual,
// live dimensions that change on rotation/resize — layout is recomputed
// from scratch on every resize rather than assuming a fixed canvas size.
export class MainMenu extends Scene {
  // A hazard-course backdrop built from the same tile/hazard art the real
  // levels use, instead of a generic stock background image — this scene
  // and the splash screen (plain HTML/CSS, can't share Phaser objects) are
  // deliberately styled from the same handful of ideas: dark gradient,
  // ground+spike floor, a spinning saw or two.
  private floor: GameObjects.TileSprite | null = null;
  private spikeRow: GameObjects.TileSprite | null = null;
  private sawA: GameObjects.Sprite | null = null;
  private sawB: GameObjects.Sprite | null = null;
  private titleShadow: GameObjects.Text | null = null;
  private title: GameObjects.Text | null = null;
  private playButton: GameObjects.Text | null = null;
  private createButton: GameObjects.Text | null = null;

  private browseButton: GameObjects.Text | null = null;

  constructor() {
    super('MainMenu');
  }

  init(): void {
    this.floor = null;
    this.spikeRow = null;
    this.sawA = null;
    this.sawB = null;
    this.titleShadow = null;
    this.title = null;
    this.playButton = null;
    this.createButton = null;
    this.browseButton = null;
  }

  create(): void {
    // The splash screen's Play/Build/Browse each expand into this same
    // 'game' entrypoint (requestExpandedMode has no way to target a scene
    // directly) and leave their intent here — honor it once, then get out
    // of the way, instead of always landing on the menu they already
    // bypassed by tapping a specific button.
    const autostart = localStorage.getItem(SPLASH_AUTOSTART_KEY);
    if (autostart) {
      localStorage.removeItem(SPLASH_AUTOSTART_KEY);
      if (autostart === 'game') {
        this.scene.start('GameScene');
        return;
      }
      if (autostart === 'editor') {
        this.scene.start('EditorScene');
        return;
      }
      if (autostart === 'browse') {
        void this.openDiscoveryScene();
        return;
      }
    }

    this.cameras.main.setBackgroundColor(0x14141f);
    ensureHazardAnims(this);
    this.refreshLayout();
    this.scale.on('resize', this.refreshLayout, this);
    this.events.once('shutdown', () =>
      this.scale.off('resize', this.refreshLayout, this)
    );
  }

  private refreshLayout(): void {
    const { width, height } = this.scale;
    const floorTop = height - FLOOR_HEIGHT;
    const spikeTop = floorTop - SPIKE_ROW_HEIGHT;

    if (!this.floor) {
      this.floor = this.add.tileSprite(0, 0, 0, FLOOR_HEIGHT, 'ground');
      this.floor.setOrigin(0, 0);
    }
    this.floor.setPosition(0, floorTop).setSize(width, FLOOR_HEIGHT);

    if (!this.spikeRow) {
      this.spikeRow = this.add.tileSprite(0, 0, 0, SPIKE_ROW_HEIGHT, 'spike');
      this.spikeRow.setOrigin(0, 0);
    }
    this.spikeRow.setPosition(0, spikeTop).setSize(width, SPIKE_ROW_HEIGHT);

    if (!this.sawA) {
      this.sawA = this.add.sprite(0, 0, 'saw-spin').setScale(1.1);
      this.sawA.play('saw-spin');
    }
    this.sawA.setPosition(width * 0.16, spikeTop - 60);

    if (!this.sawB) {
      this.sawB = this.add.sprite(0, 0, 'saw-spin').setScale(0.85);
      this.sawB.play('saw-spin');
    }
    this.sawB.setPosition(width * 0.85, spikeTop - 90);

    if (!this.titleShadow) {
      this.titleShadow = this.add
        .text(0, 0, 'CURSED', {
          fontFamily: 'Arial Black',
          fontSize: '64px',
          color: '#ff4d6d',
          align: 'center',
        })
        .setOrigin(0.5);
    }
    this.titleShadow.setPosition(width / 2 + 5, height * 0.22 + 5);

    if (!this.title) {
      this.title = this.add
        .text(0, 0, 'CURSED', {
          fontFamily: 'Arial Black',
          fontSize: '64px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 10,
          align: 'center',
        })
        .setOrigin(0.5);
    }
    this.title.setPosition(width / 2, height * 0.22);

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
    this.playButton.setPosition(width / 2, height * 0.48);

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
    this.createButton.setPosition(width / 2, height * 0.6);
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
    this.browseButton.setPosition(width / 2, height * 0.7);
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
