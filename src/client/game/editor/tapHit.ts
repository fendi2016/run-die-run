import type * as Phaser from 'phaser';
import { GRID_CELL_SIZE } from '../../../shared/constants';

// Erase leniency, in world px: how far outside an object's drawn bounds a
// tap still hits it, and how close to its center counts from any side.
const TAP_PADDING_PX = GRID_CELL_SIZE * 0.35;
const TAP_RADIUS_PX = GRID_CELL_SIZE * 1.1;

// The object a loose tap at (x, y) means: one drawn under the tap (padded —
// a mace ball hangs a cell below the cell it's stored in), else the closest
// center within about a cell. Shared by the editor's Erase and the curse
// builder's Erase so both forgive a sloppy tap the same way.
export function nearestTappedId(
  images: Iterable<[string, Phaser.GameObjects.Sprite]>,
  x: number,
  y: number
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const [id, image] of images) {
    const bounds = image.getBounds();
    const center = image.getCenter();
    const distance = Math.hypot(x - center.x, y - center.y);
    const underTap =
      x >= bounds.left - TAP_PADDING_PX && x <= bounds.right + TAP_PADDING_PX &&
      y >= bounds.top - TAP_PADDING_PX && y <= bounds.bottom + TAP_PADDING_PX;
    const hit = underTap || distance <= TAP_RADIUS_PX;
    if (hit && (!best || distance < best.distance)) best = { id, distance };
  }
  return best?.id;
}
