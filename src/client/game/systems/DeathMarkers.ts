import * as Phaser from 'phaser';
import {
  isDeathMarkersResponse,
  type DeathMarker,
  type ReportDeathRequest,
} from '../../../shared/deathsApi';

// Faint pencil ✗'s where other players died on this level version (the
// server keeps per-version counts, bucketed — see deathsApi). Reuses the
// scribble ✗ from the death animation (DeathEffects.SCRIBBLE_FX).
const MARK_TEXTURE = 'scribble-x';
const MARK_SCALE = 0.35;
const MARK_TINT = 0x2b2b2b;
// Busier spots read darker: alpha ramps from MIN to MAX with the count,
// relative to the level's worst spot.
const MIN_ALPHA = 0.3;
const MAX_ALPHA = 0.8;
// Behind the player and hazards, in front of the background.
const MARKER_DEPTH = -0.5;

export async function fetchDeathMarkers(
  levelId: string,
  version: number,
  signal: AbortSignal
): Promise<DeathMarker[]> {
  const response = await fetch(
    `/api/deaths/${encodeURIComponent(levelId)}/${version}`,
    { signal }
  );
  if (!response.ok) return [];
  const json: unknown = await response.json();
  return isDeathMarkersResponse(json) ? json.markers : [];
}

export function drawDeathMarkers(
  scene: Phaser.Scene,
  markers: DeathMarker[]
): Phaser.GameObjects.Image[] {
  const worst = Math.max(1, ...markers.map((m) => m.count));
  return markers.map((marker) => {
    const t = Math.sqrt(marker.count / worst);
    return scene.add
      .image(marker.x, marker.y, MARK_TEXTURE)
      .setOrigin(0.5, 1)
      .setScale(MARK_SCALE)
      .setTint(MARK_TINT)
      .setAlpha(MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * t)
      .setDepth(MARKER_DEPTH);
  });
}

// Fire-and-forget, like the trap-kill report: never delays the respawn.
export function reportDeathPosition(request: ReportDeathRequest): void {
  fetch('/api/deaths', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }).catch(() => {
    // Best-effort only.
  });
}
