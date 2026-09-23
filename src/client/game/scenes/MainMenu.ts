import { Scene } from 'phaser';
import { SPLASH_AUTOSTART_KEY } from '../../../shared/constants';
import { DiscoveryOverlay } from '../../ui/DiscoveryOverlay';
import { GameMenu } from '../../ui/GameMenu';

// The menu scene for game.html (the popped-out/expanded webview). Renders
// no Phaser content of its own — GameMenu is a DOM overlay styled to match
// splash.html's card, so this scene's only job is deciding whether to show
// it or bypass it entirely.
export class MainMenu extends Scene {
  constructor() {
    super('MainMenu');
  }

  create(data: { browse?: boolean } = {}): void {
    let browseRequested = data.browse === true;
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
        browseRequested = true;
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
      onBrowse: () => this.openDiscovery(),
    });
    menu.show();
    const discovery = DiscoveryOverlay.instance();
    this.events.once('shutdown', () => {
      menu.hide();
      discovery.hide();
    });
    if (browseRequested) this.openDiscovery();
  }

  // DiscoveryOverlay is a DOM overlay shown on top of GameMenu (same
  // pattern as LeaderboardOverlay) rather than a separate Phaser scene —
  // "Back" just hides it again, revealing the menu underneath.
  private openDiscovery(): void {
    DiscoveryOverlay.instance().show({
      onSelectLevel: (levelId) => this.scene.start('GameScene', { levelId }),
    });
  }
}
