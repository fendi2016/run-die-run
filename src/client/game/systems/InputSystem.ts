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
//
// Every source (each jump key, each pointer) feeds one virtual button:
// down when the first source goes down, up only when the last one lets go.
// Otherwise tapping the mouse while holding space (or W while holding
// space) sent a release mid-hold, cutting the held jump short, and its
// press counted as a new jump.
export class InputSystem {
  private readonly scene: Phaser.Scene;
  private readonly jumpKeys: Phaser.Input.Keyboard.Key[];
  private readonly held = new Set<string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const keyboard = scene.input.keyboard;
    this.jumpKeys = keyboard
      ? JUMP_KEY_CODES.map((code) => keyboard.addKey(code, false))
      : [];
    for (const key of this.jumpKeys) {
      key.on('down', this.onKeyDown, this);
      key.on('up', this.onKeyUp, this);
    }

    // Mouse click and touch tap both surface as Phaser pointer events, so
    // this single listener covers desktop click and mobile tap.
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this);
    // A key or button released while the window is unfocused never sends
    // its up event; drop everything held so jump can't get stuck down.
    window.addEventListener('blur', this.releaseAll);
  }

  destroy(): void {
    for (const key of this.jumpKeys) {
      key.off('down', this.onKeyDown, this);
      key.off('up', this.onKeyUp, this);
    }
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
    window.removeEventListener('blur', this.releaseAll);
  }

  private onKeyDown(key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void {
    if (!this.canJump()) return;
    event.preventDefault();
    this.press(`key:${key.keyCode}`);
  }

  private onKeyUp(key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void {
    if (this.canJump()) event.preventDefault();
    this.release(`key:${key.keyCode}`);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.press(`pointer:${pointer.id}`);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.release(`pointer:${pointer.id}`);
  }

  private canJump(): boolean {
    const focused = document.activeElement;
    return this.scene.sys.isActive() && !(
      focused instanceof HTMLElement && focused.matches('button, input, textarea, select')
    );
  }

  private press(source: string): void {
    if (!this.canJump()) return;
    const wasHeld = this.held.size > 0;
    this.held.add(source);
    if (!wasHeld) this.scene.events.emit(JUMP_DOWN_EVENT);
  }

  private release(source: string): void {
    if (!this.held.delete(source) || this.held.size > 0) return;
    if (this.canJump()) this.scene.events.emit(JUMP_UP_EVENT);
  }

  private releaseAll = (): void => {
    if (this.held.size === 0) return;
    this.held.clear();
    if (this.canJump()) this.scene.events.emit(JUMP_UP_EVENT);
  };
}
