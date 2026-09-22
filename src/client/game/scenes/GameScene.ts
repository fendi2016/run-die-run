import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  connectRealtime,
  disconnectRealtime,
  showToast,
} from '@devvit/web/client';
import {
  FALL_DEATH_Y,
  LOGICAL_HEIGHT,
  SEED_AUTHOR,
} from '../../../shared/constants';
import type { CurseCategory, DraftObject } from '../../../shared/editorApi';
import {
  isPublishCurseResponse,
  isVerifyLevelResponse,
} from '../../../shared/editorApi';
import {
  isRealtimeEvent,
  levelRealtimeChannel,
  type NewWorldRecordEvent,
  type VersionPublishedEvent,
} from '../../../shared/realtimeApi';
import {
  isSubmitRunResponse,
  isTrapKillResponse,
  type SubmitRunRequest,
  type TrapKillRequest,
} from '../../../shared/runsApi';
import {
  isLevelVersion,
  type LevelVersion,
  type ObjectType,
} from '../../../shared/types';
import { DeathPanel } from '../../ui/DeathPanel';
import { LeaderboardOverlay } from '../../ui/LeaderboardOverlay';
import { labelFor } from '../../ui/objectLabels';
import { PreviewBackButton } from '../../ui/PreviewBackButton';
import { RealtimeToast } from '../../ui/RealtimeToast';
import { RunResultOverlay } from '../../ui/RunResultOverlay';
import { TapToStartPrompt } from '../../ui/TapToStartPrompt';
import {
  FINISH_RESTART_DELAY_MS,
  PLAYER_SCREEN_ANCHOR,
  SLOW_TIME_DURATION_MS,
  SLOW_TIME_HAZARD_SCALE,
} from '../constants';
import { Player } from '../entities/Player';
import { getRequestedLevelId } from '../levelSelection';
import { burstParticles } from '../systems/Juice';
import { loadLevel, setPowerUpAvailable } from '../systems/LevelLoader';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';

const FALLBACK_SPAWN = { x: 80, y: LOGICAL_HEIGHT - 200 };

// Where a preview ("Test"/"Prove it's possible") run sends the player back
// to once it resolves — the base editor (spec section 13) and the curse
// flow (spec sections 14-16) both launch GameScene in preview mode, but
// they need to land somewhere different (and carry different data) once
// verification finishes.
type PreviewReturn =
  | { kind: 'editor'; objects: DraftObject[] }
  | {
      kind: 'curse';
      levelId: string;
      category: CurseCategory;
      object: DraftObject;
    };

// Data passed in via `scene.start('GameScene', data)`. Absent (a normal
// menu -> GameScene entry) means "load the requested/default published
// level and submit runs normally". `previewLevel` present means this is a
// preview run (base-editor Test or curse "Prove it's possible") — the
// level comes from the client directly instead of a fetch, and finishing
// verifies against `candidateToken` (spec section 20) instead of
// submitting to a leaderboard.
type GameSceneData = {
  previewLevel?: LevelVersion;
  candidateToken?: string;
  previewReturn?: PreviewReturn;
  levelId?: string;
};

// Level-format phase (spec section 38, Phase 3): levels are fetched from
// the server as data (LevelVersion) and built through the ObjectRegistry /
// LevelLoader, instead of the Phase 1/2 hardcoded ground/hazard layout.
export class GameScene extends Scene {
  private player: Player | undefined;
  private resultOverlay!: RunResultOverlay;
  private deathPanel!: DeathPanel;
  private tapToStartPrompt!: TapToStartPrompt;
  private levelVersion: LevelVersion | undefined;
  private levelWidth = 0;
  private spawn = FALLBACK_SPAWN;
  private runEnded = false;
  private runStartTime = 0;
  private levelRequest: AbortController | undefined;
  // Set the moment the tap-to-start gate lifts (see update()) — false for
  // the entire tap-to-start hold, forever true afterward for the rest of
  // this scene instance's life (a death-restart's own runStartTime
  // assignment in restartRun() runs unconditionally, so this flag staying
  // true just means that block is correctly skipped for every restart).
  private runStarted = false;

  // Slow Time (spec section 21) scales only these tweens' playback speed —
  // never the run timer above, which is what `runStartTime` alone drives.
  private movingObjectTweens: Phaser.Tweens.Tween[] = [];
  private resetMovingObjects: (() => void) | undefined;
  private powerUpImages: Phaser.GameObjects.Sprite[] = [];
  private slowTimeTimer: Phaser.Time.TimerEvent | undefined;

  private previewLevel: LevelVersion | undefined;
  private candidateToken: string | undefined;
  private previewReturn: PreviewReturn | undefined;
  private explicitLevelId: string | undefined;

  // Realtime (spec section 29): subscribed only for a real (non-preview)
  // level, since a preview isn't published and has no live channel. Events
  // are buffered here rather than shown immediately — the "don't interrupt
  // a run" rule (spec section 29) is enforced by only ever flushing this
  // buffer from `cleanup()`, never from `onMessage` directly.
  private pendingVersionPublished: VersionPublishedEvent | undefined;
  private pendingWorldRecord: NewWorldRecordEvent | undefined;

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData): void {
    this.previewLevel = data.previewLevel;
    this.candidateToken = data.candidateToken;
    this.previewReturn = data.previewReturn;
    this.explicitLevelId = data.levelId;

    this.player = undefined;
    this.levelVersion = undefined;
    this.levelWidth = 0;
    this.spawn = FALLBACK_SPAWN;
    this.runEnded = false;
    this.runStartTime = 0;
    this.runStarted = false;
    this.movingObjectTweens = [];
    this.resetMovingObjects = undefined;
    this.powerUpImages = [];
    this.slowTimeTimer = undefined;
    this.pendingVersionPublished = undefined;
    this.pendingWorldRecord = undefined;
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(0x1a1a2e);
    this.applyResponsiveZoom();
    this.scale.on('resize', this.applyResponsiveZoom, this);

    this.resultOverlay = new RunResultOverlay();
    this.deathPanel = new DeathPanel();
    this.deathPanel.setRetryHandler(() => this.restartRun());
    this.tapToStartPrompt = new TapToStartPrompt();
    this.events.once('shutdown', this.cleanup, this);

    void this.loadAndStart();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.player) {
      return;
    }
    this.player.update(deltaMs);

    // The tap-to-start gate lifts the instant Player's own jump-input
    // listener flips `isWaitingToStart` off (see Player.onJumpPressed) —
    // polled here rather than a duplicate event listener, since Player
    // already owns deciding what counts as "the start tap".
    if (!this.runStarted && !this.player.isWaitingToStart) {
      this.runStarted = true;
      this.tapToStartPrompt.hide();
      this.runStartTime = this.time.now;
      this.physics.resume();
      for (const tween of this.movingObjectTweens) {
        tween.resume();
      }
    }

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

    if (this.runStarted && !this.runEnded && this.player.sprite.y > FALL_DEATH_Y) {
      this.onPlayerDied();
    }
  }

  private applyResponsiveZoom(): void {
    this.cameras.main.setZoom(this.scale.height / LOGICAL_HEIGHT);
  }

  private async loadAndStart(): Promise<void> {
    if (this.previewLevel) {
      this.levelVersion = this.previewLevel;
      this.startRun(this.previewLevel);
      const previewReturn = this.previewReturn;
      PreviewBackButton.instance().setOnBack(() => {
        if (previewReturn?.kind === 'curse') {
          this.scene.start('CurseScene', {
            levelId: previewReturn.levelId,
            preselected: {
              category: previewReturn.category,
              object: previewReturn.object,
            },
          });
        } else {
          this.scene.start('EditorScene', {
            objects:
              previewReturn?.kind === 'editor' ? previewReturn.objects : [],
          });
        }
      });
      PreviewBackButton.instance().show();
      return;
    }

    const levelId = this.explicitLevelId ?? getRequestedLevelId();
    const request = new AbortController();
    this.levelRequest = request;

    let levelVersion: LevelVersion;
    try {
      const response = await fetch(
        `/api/levels/${encodeURIComponent(levelId)}`,
        { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) }
      );
      if (!response.ok) {
        throw new Error(`Level request failed: ${response.status}`);
      }
      const body: unknown = await response.json();
      if (!isLevelVersion(body)) {
        throw new Error(`Unexpected level response for "${levelId}"`);
      }
      levelVersion = body;
    } catch (error) {
      if (request.signal.aborted) return;
      console.error(`Failed to load level "${levelId}":`, error);
      showToast('Could not load this level. Please try again.');
      this.scene.start('MainMenu');
      return;
    }

    if (request.signal.aborted) return;
    this.levelRequest = undefined;
    this.levelVersion = levelVersion;
    this.subscribeRealtime(levelVersion.levelId);
    this.startRun(levelVersion);
  }

  // A live version-published/world-record toast is strictly cosmetic — it
  // must never be able to stop a level from actually loading, so a failure
  // here (a bad channel name, the realtime plugin unavailable, whatever)
  // only logs, exactly like every other non-critical network call in this
  // scene (trap-kill reporting, follow).
  private subscribeRealtime(levelId: string): void {
    try {
      connectRealtime({
        channel: levelRealtimeChannel(levelId),
        onMessage: (data) => {
          if (!isRealtimeEvent(data)) {
            return;
          }
          if (data.type === 'versionPublished') {
            this.pendingVersionPublished = data;
          } else {
            this.pendingWorldRecord = data;
          }
        },
      });
    } catch (error) {
      console.error(`Failed to subscribe to realtime updates for "${levelId}":`, error);
    }
  }

  // Flushes whatever Realtime events arrived while this scene was up, now
  // that the run they must not interrupt (spec section 29) has ended one
  // way or another (finish, or backing out to menu) — shown on whatever
  // screen comes next via RealtimeToast, not here.
  private flushRealtimeEvents(): void {
    if (this.pendingVersionPublished) {
      const { authorUsername, addedType } = this.pendingVersionPublished;
      RealtimeToast.instance().enqueue(
        `VERSION LIVE — u/${authorUsername} added a ${labelFor(addedType)}`
      );
    }
    if (this.pendingWorldRecord) {
      const { username, timeMs } = this.pendingWorldRecord;
      RealtimeToast.instance().enqueue(
        `NEW WORLD RECORD — u/${username}: ${(timeMs / 1000).toFixed(3)}s`
      );
    }
  }

  private startRun(levelVersion: LevelVersion): void {
    const player = new Player(this, 0, 0);
    this.player = player;

    const loaded = loadLevel(this, levelVersion, player.sprite, {
      onHazardHit: (objectId) => this.onHazardHit(objectId),
      onFinishReached: () => this.onFinishReached(),
      onPowerUpCollected: (type) => this.onPowerUpCollected(type),
    });

    this.spawn = loaded.spawn;
    this.levelWidth = loaded.levelWidth;
    this.movingObjectTweens = loaded.movingObjectTweens;
    this.resetMovingObjects = loaded.resetMovingObjects;
    this.powerUpImages = loaded.powerUpImages;
    this.cameras.main.setBounds(0, 0, this.levelWidth, LOGICAL_HEIGHT);

    // Tiled rather than stretched, so the art keeps its native proportions
    // across levels of any width instead of warping to fit — scaled to
    // fill LOGICAL_HEIGHT and repeated horizontally across the level.
    const bgSource = this.textures.get('level-background').getSourceImage();
    const bgScale = LOGICAL_HEIGHT / bgSource.height;
    this.add
      .tileSprite(0, 0, this.levelWidth, LOGICAL_HEIGHT, 'level-background')
      .setOrigin(0, 0)
      .setTileScale(bgScale, bgScale)
      .setScrollFactor(1, 1)
      .setDepth(-1);

    // The background art is busy/saturated enough to compete with hazard
    // sprites for attention — a flat dark scrim between it and the level
    // geometry dims it down so spikes/saws/candles read clearly on top.
    this.add
      .rectangle(0, 0, this.levelWidth, LOGICAL_HEIGHT, 0x0a0714, 0.5)
      .setOrigin(0, 0)
      .setScrollFactor(1, 1)
      .setDepth(-0.5);

    // waiting=true: hold at spawn (idle, no auto-run) until the first tap
    // — update() starts the timer and hides the prompt once Player itself
    // reports the wait is over.
    player.reset(this.spawn.x, this.spawn.y, true);
    // Keep gravity, collision callbacks, and moving objects idle together.
    // Scene input remains active so the first tap can release the gate.
    this.physics.pause();
    for (const tween of this.movingObjectTweens) {
      tween.pause();
    }
    this.tapToStartPrompt.show();
  }

  private onFinishReached(): void {
    if (this.runEnded || !this.player || !this.levelVersion) {
      return;
    }
    this.runEnded = true;
    this.player.freeze();

    // Purely cosmetic — doesn't touch `timeMs` below in any way.
    burstParticles(
      this,
      this.player.sprite.x,
      this.player.sprite.y,
      0x39ff88,
      22
    );
    this.cameras.main.flash(150, 57, 255, 136, false);

    const timeMs = Math.round(this.time.now - this.runStartTime);
    this.resultOverlay.showTime(timeMs);

    if (this.previewLevel && this.candidateToken) {
      void this.submitVerification(this.candidateToken, timeMs);
    } else {
      const levelVersion = this.levelVersion;
      this.resultOverlay.setRetryHandler(() => this.restartRun());
      this.resultOverlay.setLeaderboardHandler(() =>
        LeaderboardOverlay.instance().show()
      );
      void this.submitRun(levelVersion, timeMs);
    }
  }

  // Verification (spec section 16) is shared by both preview flows — only
  // what happens after success/failure differs, handled by the two
  // `previewReturn` branches below.
  private async submitVerification(
    candidateToken: string,
    timeMs: number
  ): Promise<void> {
    const previewReturn = this.previewReturn;
    let verified = false;
    try {
      const response = await fetch('/api/publish/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken, timeMs }),
      });
      const json: unknown = await response.json();
      verified = isVerifyLevelResponse(json) && json.status === 'ok';
    } catch {
      verified = false;
    }

    if (previewReturn?.kind === 'curse') {
      if (verified) {
        void this.publishCurseAndReturn(candidateToken, previewReturn);
      } else {
        this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
          this.scene.start('CurseScene', {
            levelId: previewReturn.levelId,
            preselected: {
              category: previewReturn.category,
              object: previewReturn.object,
            },
          });
        });
      }
      return;
    }

    const returnObjects =
      previewReturn?.kind === 'editor' ? previewReturn.objects : [];
    this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
      this.scene.start('EditorScene', {
        objects: returnObjects,
        verifiedCandidateToken: verified ? candidateToken : undefined,
      });
    });
  }

  // A curse has nothing left to decide once verification succeeds — spec
  // section 15's "PROVE IT'S POSSIBLE" already collected the one object and
  // the title/category choice, unlike the base editor which still needs a
  // separate title entry before publish. Publish immediately, then land
  // the player back in the now-updated live level so they can see (and
  // replay) their contribution.
  private async publishCurseAndReturn(
    candidateToken: string,
    previewReturn: Extract<PreviewReturn, { kind: 'curse' }>
  ): Promise<void> {
    let message = 'Could not publish your curse — please try again.';
    let conflict = false;
    let published = false;
    try {
      const response = await fetch('/api/curse/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken }),
      });
      const json: unknown = await response.json();
      if (isPublishCurseResponse(json)) {
        if (json.status === 'ok') {
          published = true;
        } else {
          message = json.message;
          conflict = json.conflict === true;
        }
      }
    } catch {
      // message/conflict already default to the network-failure case
    }

    this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
      if (published) {
        this.scene.start('GameScene', { levelId: previewReturn.levelId });
        return;
      }
      this.scene.start('CurseScene', {
        levelId: previewReturn.levelId,
        preselected: conflict
          ? undefined
          : { category: previewReturn.category, object: previewReturn.object },
        message,
      });
    });
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
          this.resultOverlay.setCurseHandler(() =>
            this.scene.start('CurseScene', { levelId: levelVersion.levelId })
          );
        } else {
          console.error('Unexpected /api/runs response shape', body);
        }
      } else {
        console.error(`Run submission failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to submit run:', error);
    }
  }

  // Shield (spec section 21) absorbs the next fatal hit and never reaches
  // death/attribution at all — checked here, before `onPlayerDied`, since
  // an absorbed hit isn't a death and shouldn't award a trap kill.
  private onHazardHit(objectId: string): void {
    if (this.player?.tryAbsorbHit()) {
      return;
    }
    this.onPlayerDied(objectId);
  }

  private onPowerUpCollected(type: ObjectType): void {
    if (!this.player) {
      return;
    }
    switch (type) {
      case 'doubleJump':
        this.player.grantDoubleJump();
        break;
      case 'shield':
        this.player.grantShield();
        break;
      case 'speedBoost':
        this.player.applySpeedBoost();
        break;
      case 'autoDash':
        this.player.applyDash();
        break;
      case 'slowTime':
        this.applySlowTime();
        break;
      default:
        break;
    }
  }

  // Scales moving hazard/platform tweens only — `runStartTime`/the timer
  // are untouched, so this can never leak into a submitted time (spec
  // section 21: "Do NOT slow the actual run timer").
  private applySlowTime(): void {
    for (const tween of this.movingObjectTweens) {
      tween.timeScale = SLOW_TIME_HAZARD_SCALE;
    }
    this.slowTimeTimer?.remove();
    this.slowTimeTimer = this.time.delayedCall(SLOW_TIME_DURATION_MS, () => {
      for (const tween of this.movingObjectTweens) {
        tween.timeScale = 1;
      }
      this.slowTimeTimer = undefined;
    });
  }

  // `objectId` is absent for a fall-death (running off the level, not a
  // placed hazard) — there's nothing to attribute in that case, but the
  // death panel (and its Retry button, the only way to restart now) still
  // needs to show either way.
  private onPlayerDied(objectId?: string): void {
    if (this.runEnded || !this.player) {
      return;
    }
    this.runEnded = true;
    if (objectId) {
      this.reportHazardDeath(objectId);
    } else {
      this.deathPanel.show();
    }
    this.player.die();
  }

  // Attribution (spec section 23) is shown instantly from data already on
  // the client — the network call only grows the server-authoritative kill
  // counters in the background, fire-and-forget.
  private reportHazardDeath(objectId: string): void {
    const object = this.levelVersion?.objects.find((o) => o.id === objectId);
    if (!object) {
      this.deathPanel.show();
      return;
    }

    const attributedAuthor =
      object.addedBy === SEED_AUTHOR ? undefined : object.addedBy;
    const shownToken = this.deathPanel.show(
      attributedAuthor,
      attributedAuthor ? object.type : undefined
    );

    if (this.previewLevel) {
      // A preview/curse-test run's objects may not exist in Redis yet —
      // nothing to report to.
      return;
    }
    const levelId = this.levelVersion?.levelId;
    const version = this.levelVersion?.version;
    if (!levelId || version === undefined) {
      return;
    }

    const request: TrapKillRequest = { levelId, version, objectId };
    fetch('/api/runs/trap-kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json: unknown) => {
        if (attributedAuthor !== undefined && isTrapKillResponse(json)) {
          this.deathPanel.setKillCount(shownToken, json.kills);
        }
      })
      .catch(() => {
        // Best-effort only — the instant attribution line already showed.
      });
  }

  private restartRun(): void {
    if (!this.player) {
      return;
    }
    this.resultOverlay.hide();
    this.deathPanel.hide();
    this.player.reset(this.spawn.x, this.spawn.y);
    this.cameras.main.scrollX = 0;
    this.runStartTime = this.time.now;
    this.runEnded = false;

    // Power-ups are re-collectible each attempt (spec section 21's
    // pickups are deterministic, not consumed forever) — the world
    // persists across a same-scene restart, so collected ones must be
    // brought back by hand rather than by reloading the level.
    for (const image of this.powerUpImages) {
      setPowerUpAvailable(image, true);
    }
    this.slowTimeTimer?.remove();
    this.slowTimeTimer = undefined;
    this.resetMovingObjects?.();
  }

  private cleanup(): void {
    this.levelRequest?.abort();
    this.levelRequest = undefined;
    // No physics.resume() needed here: ArcadePhysics's own 'shutdown'
    // listener (registered during the scene's start(), before create()'s
    // this.events.once('shutdown', this.cleanup) below) already runs first
    // in Phaser's registration-order event dispatch and nulls out
    // this.physics.world — calling resume() after that throws
    // ("Cannot read properties of null (reading 'resume')"), aborting
    // whatever scene.start() transition triggered this shutdown (this is
    // what made "Curse This Level" freeze the game). A re-entered scene
    // gets a brand new, unpaused World instance anyway, so there was
    // never anything here that needed resuming.
    this.resultOverlay.hide();
    this.deathPanel.hide();
    this.tapToStartPrompt.hide();
    this.player?.destroy();
    this.scale.off('resize', this.applyResponsiveZoom, this);
    PreviewBackButton.instance().hide();
    if (this.levelVersion) {
      disconnectRealtime(levelRealtimeChannel(this.levelVersion.levelId));
    }
    this.flushRealtimeEvents();
  }
}
