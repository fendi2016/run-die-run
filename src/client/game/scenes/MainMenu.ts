import { Scene } from 'phaser';
import { SPLASH_AUTOSTART_KEY } from '../../../shared/constants';
import { GameMenu } from '../../ui/GameMenu';

// The menu scene for game.html (the popped-out/expanded webview). Renders
// no Phaser content of its own — GameMenu is a DOM overlay styled to match
// splash.html's card, so this scene's only job is deciding whether to show
// it or bypass it entirely.
export class MainMenu extends Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    // The splash screen's Play/Build/Browse each expand into this same
    // 'game' entrypoint (requestExpandedMode has no way to target a scene
    // directly) and leave their intent here — honor it once, then get out
    // of the way, instead of always landing on the menu they already
    // bypassed by tapping a specific button.
    let autostart: string | null = null;
    try {
      autostart = localStorage.getItem(SPLASH_AUTOSTART_KEY);
      localStorage.removeItem(SPLASH_AUTOSTART_KEY);
    } catch {
      // The menu remains usable when embedded storage is unavailable.
    }
    if (autostart) {
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

    // A one-frame safety net against the game's own '#028af8' default
    // background flashing through before GameMenu's opaque DOM overlay
    // paints on top of the canvas.
    this.cameras.main.setBackgroundColor(0x14141f);

    const menu = GameMenu.instance();
    menu.setHandlers({
      onPlay: () => this.scene.start('GameScene'),
      onBuild: () => this.scene.start('EditorScene'),
      onBrowse: () => void this.openDiscoveryScene(),
    });
    menu.show();
    this.events.once('shutdown', () => menu.hide());
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
      // scenes would then run concurrently, leaving the menu overlay
      // showing on top. Add it inactive, then start it the same way the
      // repeat-click path (`this.scene.get(...)` above) already does.
      this.scene.add('DiscoveryScene', DiscoveryScene, false);
      this.scene.start('DiscoveryScene');
    } finally {
      this.loadingDiscovery = false;
    }
  }
}
