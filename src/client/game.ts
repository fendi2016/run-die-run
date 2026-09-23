import { Boot } from './game/scenes/Boot';
import { CurseScene } from './game/scenes/CurseScene';
import { EditorScene } from './game/scenes/EditorScene';
import { GameScene } from './game/scenes/GameScene';
import { MainMenu } from './game/scenes/MainMenu';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import FlashPlugin from 'phaser4-rex-plugins/plugins/flash-plugin.js';
import { Preloader } from './game/scenes/Preloader';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../shared/constants';
import { GRAVITY_Y } from './game/constants';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#14141f',
  // Without this, every textured Game Object (the player, ground tiles,
  // hazards...) draws at whatever sub-pixel position the camera's scroll
  // math lands on. GameScene's camera zoom is `scale.height / 540`
  // (see `applyResponsiveZoom`), which is essentially never a whole
  // number on a real device viewport, and `scrollX` tracks the player's
  // continuously-moving float `x` every frame — the combination reads as
  // a constant shimmer/shake on anything on screen, worst on the player
  // since it's the highest-contrast, most-scrutinized sprite. Snapping
  // every textured object to whole-integer device pixels each frame
  // removes that sub-pixel shimmer entirely.
  render: {
    roundPixels: true,
  },
  scale: {
    // RESIZE fills the full device viewport edge-to-edge — no letterbox
    // bars — which is what "full screen" on mobile requires. Fairness
    // across aspect ratios (spec section 5) is no longer handled by the
    // scale mode; GameScene locks the camera's vertical zoom to
    // LOGICAL_HEIGHT instead, so gameplay height is always identical and
    // only the horizontal peripheral space revealed varies by device.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY_Y },
      debug: false,
    },
  },
  // rexBoard (phaser4-rex-plugins) owns the editor's grid math and tile-tap
  // gesture detection (EditorScene) instead of hand-rolled tile<->world
  // conversion and pointer drag-threshold heuristics — a maintained,
  // widely-used library for exactly this job rather than reinventing it.
  // rexFlash is a base plugin, installed globally and looked up per-scene
  // via `this.plugins.get(key)`. The finish/power-up glow previously used
  // a third rex-plugins module (rexOutlinePipeline) — swapped for Phaser
  // 4's own built-in Filters.Glow (see Juice.ts's `applyOutlineGlow`),
  // which needs no plugin registration at all. The level browser (spec
  // sections 26-27) used to pull in a fourth module (rexUI's GridTable,
  // ~50 components for one scrollable list) but is a DOM overlay now
  // (DiscoveryOverlay), so that dependency is gone entirely.
  plugins: {
    global: [{ key: 'rexFlash', plugin: FlashPlugin, start: true }],
    scene: [{ key: 'rexBoard', plugin: BoardPlugin, mapping: 'rexBoard' }],
  },
  scene: [Boot, Preloader, MainMenu, GameScene, EditorScene, CurseScene],
};

// Lets the headless Playwright playtest harness (and manual devtools
// poking) reach the live Phaser.Game instance — a declaration merge
// rather than a cast, per house style. The devvit Vite plugin only
// supports `vite build` (no dev server), so there's no separate dev/prod
// bundle here to gate this behind.
declare global {
  interface Window {
    __PHASER_GAME__?: Phaser.Game;
  }
}

const StartGame = (parent: string) => {
  const game = new Game({ ...config, parent });
  window.__PHASER_GAME__ = game;
  return game;
};

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
