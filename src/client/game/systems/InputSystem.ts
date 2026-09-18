import * as Phaser from 'phaser';

const JUMP_KEY_CODES = [
  Phaser.Input.Keyboard.KeyCodes.SPACE,
  Phaser.Input.Keyboard.KeyCodes.UP,
  Phaser.Input.Keyboard.KeyCodes.W,
];

export const JUMP_DOWN_EVENT = 'jumpdown';
export const JUMP_UP_EVENT = 'jumpup';

// Normalizes keyboard, mouse click, and touch tap into one `jump` signal
// (scene events JUMP_DOWN_EVENT / JUMP_UP_EVENT) so gameplay code never
// branches on input device. This is what keeps mobile and desktop on
// identical controls (spec sections 2 and 4) by construction.
export class InputSystem {
  private readonly scene: Phaser.Scene;
  private readonly jumpKeys: Phaser.Input.Keyboard.Key[];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const keyboard = scene.input.keyboard;
    this.jumpKeys = keyboard
      ? JUMP_KEY_CODES.map((code) => keyboard.addKey(code))
      : [];
    for (const key of this.jumpKeys) {
      key.on('down', this.emitJumpDown, this);
      key.on('up', this.emitJumpUp, this);
    }

    // Mouse click and touch tap both surface as Phaser pointer events, so
    // this single listener covers desktop click and mobile tap.
    scene.input.on('pointerdown', this.emitJumpDown, this);
    scene.input.on('pointerup', this.emitJumpUp, this);
  }

  destroy(): void {
    for (const key of this.jumpKeys) {
      key.off('down', this.emitJumpDown, this);
      key.off('up', this.emitJumpUp, this);
    }
    this.scene.input.off('pointerdown', this.emitJumpDown, this);
    this.scene.input.off('pointerup', this.emitJumpUp, this);
  }

  private emitJumpDown(): void {
    this.scene.events.emit(JUMP_DOWN_EVENT);
  }

  private emitJumpUp(): void {
    this.scene.events.emit(JUMP_UP_EVENT);
  }
}
