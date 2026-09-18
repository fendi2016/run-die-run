import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { FALL_DEATH_Y, LOGICAL_HEIGHT } from '../../../shared/constants';
import {
  isSubmitRunResponse,
  type SubmitRunRequest,
} from '../../../shared/runsApi';
import { isLevelVersion, type LevelVersion } from '../../../shared/types';
import { RunResultOverlay } from '../../ui/RunResultOverlay';
import {
  DEATH_RESTART_DELAY_MS,
  FINISH_RESTART_DELAY_MS,
  PLAYER_SCREEN_ANCHOR,
} from '../constants';
import { Player } from '../entities/Player';
import { getRequestedLevelId } from '../levelSelection';
import { loadLevel } from '../systems/LevelLoader';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

const FALLBACK_SPAWN = { x: 80, y: LOGICAL_HEIGHT - 200 };

// Level-format phase (spec section 38, Phase 3): levels are fetched from
// the server as data (LevelVersion) and built through the ObjectRegistry /
// LevelLoader, instead of the Phase 1/2 hardcoded ground/hazard layout.
export class GameScene extends Scene {
  private player: Player | undefined;
  private resultOverlay!: RunResultOverlay;
  private levelVersion: LevelVersion | undefined;
  private levelWidth = 0;
  private spawn = FALLBACK_SPAWN;
  private runEnded = false;
  private runStartTime = 0;

  constructor() {
    super('GameScene');
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(0x1a1a2e);
    this.applyResponsiveZoom();
    this.scale.on('resize', this.applyResponsiveZoom, this);

    this.resultOverlay = new RunResultOverlay();
    this.events.once('shutdown', this.cleanup, this);

    void this.loadAndStart();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.player) {
      return;
    }
    this.player.update(deltaMs);

    // Vertical zoom is locked to LOGICAL_HEIGHT (see applyResponsiveZoom),
    // so the world-space width actually on screen varies with device
    // aspect ratio — narrower on a tall phone, wider on a desktop.
    const visibleWorldWidth = this.scale.width / this.cameras.main.zoom;
    const targetScrollX =
      this.player.sprite.x - visibleWorldWidth * PLAYER_SCREEN_ANCHOR;
    this.cameras.main.scrollX = Phaser.Math.Clamp(
      targetScrollX,
      0,
      Math.max(0, this.levelWidth - visibleWorldWidth)
    );

    if (!this.runEnded && this.player.sprite.y > FALL_DEATH_Y) {
      this.onPlayerDied();
    }
  }

  private applyResponsiveZoom(): void {
    this.cameras.main.setZoom(this.scale.height / LOGICAL_HEIGHT);
  }

  private async loadAndStart(): Promise<void> {
    const levelId = getRequestedLevelId();

    let levelVersion: LevelVersion;
    try {
      const response = await fetch(
        `/api/levels/${encodeURIComponent(levelId)}`
      );
      if (!response.ok) {
        console.error(`Failed to load level "${levelId}": ${response.status}`);
        return;
      }
      const body: unknown = await response.json();
      if (!isLevelVersion(body)) {
        console.error(
          `Unexpected /api/levels response shape for "${levelId}"`,
          body
        );
        return;
      }
      levelVersion = body;
    } catch (error) {
      console.error(`Failed to load level "${levelId}":`, error);
      return;
    }

    this.levelVersion = levelVersion;
    this.startRun(levelVersion);
  }

  private startRun(levelVersion: LevelVersion): void {
    const player = new Player(this, 0, 0);
    this.player = player;

    const loaded = loadLevel(this, levelVersion, player.sprite, {
      onHazardHit: () => this.onPlayerDied(),
      onFinishReached: () => this.onFinishReached(),
    });

    this.spawn = loaded.spawn;
    this.levelWidth = loaded.levelWidth;
    this.cameras.main.setBounds(0, 0, this.levelWidth, LOGICAL_HEIGHT);

    player.reset(this.spawn.x, this.spawn.y);
    this.runStartTime = this.time.now;
  }

  private onFinishReached(): void {
    if (this.runEnded || !this.player || !this.levelVersion) {
      return;
    }
    this.runEnded = true;
    this.player.freeze();

    const timeMs = Math.round(this.time.now - this.runStartTime);
    this.resultOverlay.showTime(timeMs);
    void this.submitRun(this.levelVersion, timeMs);
  }

  private async submitRun(
    levelVersion: LevelVersion,
    timeMs: number
  ): Promise<void> {
    try {
      const request: SubmitRunRequest = {
        levelId: levelVersion.levelId,
        version: levelVersion.version,
        timeMs,
      };
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        const body: unknown = await response.json();
        if (isSubmitRunResponse(body)) {
          this.resultOverlay.showResult(body);
        } else {
          console.error('Unexpected /api/runs response shape', body);
        }
      } else {
        console.error(`Run submission failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to submit run:', error);
    }

    this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => this.restartRun());
  }

  private onPlayerDied(): void {
    if (this.runEnded || !this.player) {
      return;
    }
    this.runEnded = true;
    this.player.die(() =>
      this.time.delayedCall(DEATH_RESTART_DELAY_MS, () => this.restartRun())
    );
  }

  private restartRun(): void {
    if (!this.player) {
      return;
    }
    this.resultOverlay.hide();
    this.player.reset(this.spawn.x, this.spawn.y);
    this.cameras.main.scrollX = 0;
    this.runStartTime = this.time.now;
    this.runEnded = false;
  }

  private cleanup(): void {
    this.player?.destroy();
    this.scale.off('resize', this.applyResponsiveZoom, this);
  }
}
