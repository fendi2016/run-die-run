import * as Phaser from 'phaser';
import {
  isDeathMarkersResponse,
  type DeathMarker,
  type ReportDeathRequest,
} from '../../../shared/deathsApi';

// Faint skulls where other players died on this level version (the
// server keeps per-version counts, bucketed — see deathsApi). The
// skull-and-crossbones pose of the skull-smoke VFX sheet doubles as the
// marker, so no extra texture to load.
const SKULL_TEXTURE = 'ghost-skull-smoke';
const SKULL_FRAME = 2;
const SKULL_SCALE = 0.6;
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
      .image(marker.x, marker.y, SKULL_TEXTURE, SKULL_FRAME)
      .setOrigin(0.5, 1)
      .setScale(SKULL_SCALE)
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
