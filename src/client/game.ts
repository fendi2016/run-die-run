import { Boot } from './game/scenes/Boot';
import { GameScene } from './game/scenes/GameScene';
import { MainMenu } from './game/scenes/MainMenu';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Preloader } from './game/scenes/Preloader';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../shared/constants';
import { GRAVITY_Y } from './game/constants';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#028af8',
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
  scene: [Boot, Preloader, MainMenu, GameScene],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

document.addEventListener('DOMContentLoaded', () => {
  StartGame('game-container');
});
