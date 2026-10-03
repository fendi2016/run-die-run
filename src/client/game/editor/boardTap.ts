import type * as Phaser from 'phaser';
import type BoardPlugin from 'phaser4-rex-plugins/plugins/board-plugin.js';
import Tap from 'phaser4-rex-plugins/plugins/input/gestures/tap/Tap.js';

// Finger-friendly taps on the editor/curse board, via rex's Tap gesture
// (the same one the board's own tiletap uses, but configurable). Its
// defaults are tuned for mice and missed real taps on phones: a tap held
// past 250ms became a "press", 9px of finger drift cancelled it, and it
// waited 200ms after release to count double-taps nothing here uses.
const TAP_CONFIG: Tap.IConfig = {
  time: 600,
  threshold: 14,
  tapInterval: 0,
};

export function onBoardTap(
  scene: Phaser.Scene,
  board: BoardPlugin.Board,
  handler: (pointer: Phaser.Input.Pointer, tileXY: { x: number; y: number }) => void
): void {
  const tap = new Tap(scene, TAP_CONFIG);
  tap.on('tap', (_tap: Tap, _target: unknown, pointer: Phaser.Input.Pointer) => {
    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileXY = board.worldXYToTileXY(world.x, world.y);
    if (!board.contains(tileXY.x, tileXY.y)) return;
    handler(pointer, tileXY);
  });
  scene.events.once('shutdown', () => tap.destroy());
}
