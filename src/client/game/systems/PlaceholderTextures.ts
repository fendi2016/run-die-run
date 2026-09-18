import * as Phaser from 'phaser';
import { GRID_CELL_SIZE } from '../../../shared/constants';

// Procedurally generated placeholder art so gameplay doesn't wait on an
// asset pipeline (spec section 32: "do not spend excessive time on art
// before gameplay works"). Swap for real sprites in the polish phase.
export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('player')) {
    return;
  }

  const graphics = scene.add.graphics();

  graphics.clear();
  graphics.fillStyle(0xff4d6d, 1);
  graphics.fillRoundedRect(0, 0, 40, 40, 10);
  graphics.fillStyle(0x1a1a2e, 1);
  graphics.fillCircle(13, 16, 4);
  graphics.fillCircle(27, 16, 4);
  graphics.generateTexture('player', 40, 40);

  // Ground/platform are sized to the grid cell so per-tile placement
  // (ObjectRegistry) lines up cleanly with no gaps or overlap.
  graphics.clear();
  graphics.fillStyle(0x3a2e39, 1);
  graphics.fillRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE);
  graphics.generateTexture('ground', GRID_CELL_SIZE, GRID_CELL_SIZE);

  graphics.clear();
  graphics.fillStyle(0x8a7157, 1);
  graphics.fillRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE / 3);
  graphics.generateTexture('platform', GRID_CELL_SIZE, GRID_CELL_SIZE / 3);

  graphics.clear();
  graphics.fillStyle(0xffd23f, 1);
  graphics.fillTriangle(0, 40, 20, 0, 40, 40);
  graphics.generateTexture('spike', 40, 40);

  graphics.clear();
  graphics.fillStyle(0xc0c6d4, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.fillStyle(0x1a1a2e, 1);
  graphics.fillCircle(20, 20, 6);
  graphics.generateTexture('saw', 40, 40);

  graphics.clear();
  graphics.fillStyle(0x39ff88, 1);
  graphics.fillRoundedRect(0, 0, 40, 120, 12);
  graphics.generateTexture('finish', 40, 120);

  graphics.destroy();
}
