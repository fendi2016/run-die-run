import * as Phaser from 'phaser';
import { GRID_CELL_SIZE } from '../../../shared/constants';

// Procedurally generated placeholder art so gameplay doesn't wait on an
// asset pipeline (spec section 32: "do not spend excessive time on art
// before gameplay works"). Swap for real sprites in the polish phase.
export function ensurePlaceholderTextures(scene: Phaser.Scene): void {
  // The player textures are real art loaded by Preloader (not placeholders),
  // so they can't be the guard here — use 'ground' to detect "already
  // generated".
  if (scene.textures.exists('ground')) {
    return;
  }

  const graphics = scene.add.graphics();

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

  // Power-ups (spec section 21): a distinct color per pickup, plus a
  // simple icon so they read as different at a glance even at placeholder
  // fidelity.
  graphics.clear();
  graphics.fillStyle(0x4dd2ff, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.fillStyle(0x0f0f0f, 1);
  graphics.fillTriangle(20, 8, 10, 20, 30, 20);
  graphics.fillTriangle(20, 20, 10, 32, 30, 32);
  graphics.generateTexture('doubleJump', 40, 40);

  graphics.clear();
  graphics.fillStyle(0x4d79ff, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.lineStyle(4, 0x0f0f0f, 1);
  graphics.strokeCircle(20, 20, 11);
  graphics.generateTexture('shield', 40, 40);

  graphics.clear();
  graphics.fillStyle(0xff9f4d, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.fillStyle(0x0f0f0f, 1);
  graphics.fillTriangle(10, 12, 10, 28, 24, 20);
  graphics.fillTriangle(20, 12, 20, 28, 34, 20);
  graphics.generateTexture('speedBoost', 40, 40);

  graphics.clear();
  graphics.fillStyle(0xb14dff, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.lineStyle(3, 0x0f0f0f, 1);
  graphics.strokeCircle(20, 20, 13);
  graphics.lineBetween(20, 20, 20, 11);
  graphics.lineBetween(20, 20, 27, 24);
  graphics.generateTexture('slowTime', 40, 40);

  graphics.clear();
  graphics.fillStyle(0xfff44d, 1);
  graphics.fillCircle(20, 20, 20);
  graphics.fillStyle(0x0f0f0f, 1);
  graphics.fillTriangle(8, 20, 22, 10, 22, 30);
  graphics.fillTriangle(20, 20, 34, 10, 34, 30);
  graphics.generateTexture('autoDash', 40, 40);

  // A single small dot, reused by every particle burst (death/finish
  // juice, spec section 31) — tinted per-effect via the emitter config
  // rather than baking color into the texture.
  graphics.clear();
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(6, 6, 6);
  graphics.generateTexture('particle', 12, 12);

  graphics.destroy();
}
