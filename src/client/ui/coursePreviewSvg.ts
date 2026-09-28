import { GROUND_TOP_Y } from '../../shared/constants';
import type { CoursePreview } from '../../shared/coursePreview';
import type { ObjectType } from '../../shared/types';

// The feed card's course silhouette. Scaled horizontally to the strip, but
// markers keep a fixed on-screen size so a 90-column level still shows
// every trap at 360px. Numbers and fixed colors only — never level text —
// so the markup is safe to assign with innerHTML.
const TOP_Y = GROUND_TOP_Y - 240; // highest point drawn (platforms, flyers)
const HAZARD_COLORS: Partial<Record<ObjectType, string>> = {
  candle: '#ffb347', saw: '#d9d9d9', movingSaw: '#d9d9d9', bat: '#b36bff', ghost: '#e0f7ff', fallingBlock: '#8a7f99',
};
const MARKER_R = 3.5;

export function renderCoursePreviewSvg(preview: CoursePreview, widthPx: number, heightPx: number): string {
  const inset = MARKER_R + 1;
  const scaleX = (widthPx - inset * 2) / Math.max(1, preview.width);
  const sx = (x: number) => (inset + x * scaleX).toFixed(1);
  const groundY = heightPx - 6;
  const sy = (y: number) => Math.max(MARKER_R, Math.min(groundY, groundY - ((GROUND_TOP_Y - y) / (GROUND_TOP_Y - TOP_Y)) * (groundY - MARKER_R))).toFixed(1);
  const parts: string[] = [];
  for (const [from, to] of preview.ground) {
    parts.push(`<rect x="${sx(from)}" y="${groundY}" width="${(Math.max(0, to - from) * scaleX).toFixed(1)}" height="6" fill="#39ff88"/>`);
  }
  for (const p of preview.platforms) {
    parts.push(`<rect x="${sx(p.x - 30)}" y="${sy(p.y)}" width="${(60 * scaleX).toFixed(1)}" height="3" fill="#6f8f7a"/>`);
  }
  for (const h of preview.hazards) {
    parts.push(`<circle cx="${sx(h.x)}" cy="${(Number(sy(h.y)) - MARKER_R).toFixed(1)}" r="${MARKER_R}" fill="${HAZARD_COLORS[h.type] ?? '#ff3b5c'}" stroke="#000" stroke-width="1"/>`);
  }
  parts.push(`<rect x="${sx(preview.finishX)}" y="${groundY - 14}" width="3" height="14" fill="#ffd166"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" aria-hidden="true">${parts.join('')}</svg>`;
}
