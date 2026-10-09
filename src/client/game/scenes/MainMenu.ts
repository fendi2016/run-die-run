import { Scene } from 'phaser';
import { SPLASH_AUTOSTART_KEY } from '../../../shared/constants';
import { CurseRevealPanel, takeCurseReveal } from '../../ui/CurseReveal';
import { DiscoveryOverlay } from '../../ui/DiscoveryOverlay';
import { GameMenu } from '../../ui/GameMenu';
import { isTutorialDone, prefetchTutorialStatus } from '../levels/tutorial';
import { setLeavePlace } from '../../leaveTracker';

// The menu scene for game.html (the popped-out/expanded webview). Renders
// no Phaser content of its own — GameMenu is a DOM overlay styled to match
// splash.html's card, so this scene's only job is deciding whether to show
// it or bypass it entirely.
export class MainMenu extends Scene {
  // Set while Play waits on the tutorial lookup, so a double tap doesn't
  // start GameScene twice.
  private starting = false;

  constructor() {
    super('MainMenu');
  }

  create(data: { browse?: boolean } = {}): void {
    this.starting = false;
    setLeavePlace('menu');
    prefetchTutorialStatus();
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
    // News of the player's traps comes first — but only if it's already
    // in; Play from the feed card otherwise goes straight into the level.
    // The feed card's Build/Browse/Leaderboard/STATS asked for something
    // else, so the news waits for the next time the menu opens.
    const reveal = autostart === null || autostart === 'game' ? takeCurseReveal() : undefined;
    if (autostart) {
      if (autostart === 'game' && !reveal) {
        this.play();
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
      onPlay: () => this.play(),
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
    // The feed card's Leaderboard and STATS land on the menu with that
    // overlay already open, the same as tapping it here.
    if (autostart === 'leaderboard') menu.openLeaderboard();
    if (autostart === 'stats') menu.openStats();
    if (reveal) {
      const panel = CurseRevealPanel.instance();
      this.events.once('shutdown', () => panel.hide());
      menu.hideStatsBadge();
      panel.show(reveal, {
        onSeeIt: () =>
          this.scene.start('GameScene', {
            levelId: reveal.curse.levelId,
            focusTrap: { objectId: reveal.curse.objectId, caught: reveal.curse.caught },
          }),
        // From the feed card's Play: carry on into the level they tapped.
        onDismiss: () => {
          if (autostart === 'game') this.play();
        },
        dismissLabel: autostart === 'game' ? 'Play' : 'Later',
      });
    }
  }

  // A first Play on this device runs the tutorial, which then continues to
  // the level this post plays. Picking a level from Browse skips it — that
  // player already knows what they want.
  private play(): void {
    if (this.starting) return;
    this.starting = true;
    void isTutorialDone().then((done) => {
      if (!this.scene.isActive()) return;
      this.scene.start('GameScene', done ? {} : { tutorial: true });
    });
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
