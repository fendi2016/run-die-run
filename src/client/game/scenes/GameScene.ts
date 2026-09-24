import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  connectRealtime,
  disconnectRealtime,
  showShareSheet,
} from '@devvit/web/client';
import type { T3 } from '@devvit/web/shared';
import {
  DEV_SUBREDDIT,
  FALL_DEATH_Y,
  LOGICAL_HEIGHT,
  SEED_AUTHOR,
} from '../../../shared/constants';
import {
  isDiscoveryResponse,
  isLevelStats,
  type LevelStats,
} from '../../../shared/discoveryApi';
import { currentSubredditName } from '../../devvitContext';
import { withTimeout } from '../../net';
import { GameplayControls } from '../../ui/GameplayControls';
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
  type LevelObject,
  type LevelVersion,
  type ObjectType,
} from '../../../shared/types';
import { DeathPanel } from '../../ui/DeathPanel';
import { LeaderboardOverlay } from '../../ui/LeaderboardOverlay';
import { labelFor } from '../../../shared/objectLabels';
import { PreviewBackButton } from '../../ui/PreviewBackButton';
import { RealtimeToast } from '../../ui/RealtimeToast';
import { RunResultOverlay } from '../../ui/RunResultOverlay';
import { TapToStartPrompt } from '../../ui/TapToStartPrompt';
import { clearRateText } from '../../ui/levelStatsText';
import { FINISH_RESTART_DELAY_MS, PLAYER_SCREEN_ANCHOR } from '../constants';
import { Player } from '../entities/Player';
import { getRequestedLevelId } from '../levelSelection';
import { takePrefetchedLevel } from '../levelPrefetch';
import { burstParticles, playFinishBellAnimation, setFinishFrame } from '../systems/Juice';
import { playSfx } from '../systems/Sfx';
import { loadLevel, setPowerUpAvailable, type LoadedBat } from '../systems/LevelLoader';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';
import { triggerBatFlight } from '../objects/ObjectRegistry';

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
      extendByTiles?: number;
      removeObjectId?: string;
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
// A local guard rather than @devvit/web/shared's isT3, so the client
// bundle only takes a type from that package, not its runtime.
function isPostId(id: string): id is T3 {
  return id.startsWith('t3_');
}

export class GameScene extends Scene {
  private player: Player | undefined;
  private resultOverlay!: RunResultOverlay;
  private deathPanel!: DeathPanel;
  private tapToStartPrompt!: TapToStartPrompt;
  private levelVersion: LevelVersion | undefined;
  private levelWidth = 0;
  private spawn = FALLBACK_SPAWN;
  private runEnded = false;
  private runElapsedMs = 0;
  private controls!: GameplayControls;
  private paused = false;
  private attempt = new AbortController();
  private submitting = false;
  private findingNext = false;
  private levelRequest: AbortController | undefined;
  // Set the moment the tap-to-start gate lifts (see update()) — false for
  // the entire tap-to-start hold, forever true afterward for the rest of
  // this scene instance's life (a death-restart's own runElapsedMs
  // assignment in restartRun() runs unconditionally, so this flag staying
  // true just means that block is correctly skipped for every restart).
  private runStarted = false;

  private movingObjectTweens: Phaser.Tweens.Tween[] = [];
  private resetMovingObjects: (() => void) | undefined;
  private powerUpImages: Phaser.GameObjects.Sprite[] = [];
  private bats: LoadedBat[] = [];
  private finishSprite: Phaser.GameObjects.Sprite | undefined;

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
  // For the share sheet's copy ("... after 23 deaths") and target post.
  private deathsThisLevel = 0;
  private levelStats: LevelStats | undefined;

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
    this.runElapsedMs = 0;
    this.paused = false;
    this.attempt = new AbortController();
    this.submitting = false;
    this.findingNext = false;
    this.runStarted = false;
    this.movingObjectTweens = [];
    this.resetMovingObjects = undefined;
    this.powerUpImages = [];
    this.bats = [];
    this.finishSprite = undefined;
    this.pendingVersionPublished = undefined;
    this.pendingWorldRecord = undefined;
    this.deathsThisLevel = 0;
    this.levelStats = undefined;
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
    this.controls = new GameplayControls({
      pause: () => this.pauseRun(),
      resume: () => this.resumeRun(),
      restart: () => this.restartRun(),
      retryLoad: () => void this.loadAndStart(),
      menu: () => this.scene.start('MainMenu'),
      browse: () => this.scene.start('MainMenu', { browse: true }),
    }, Boolean(this.previewLevel));
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onLeaveApp);
    window.addEventListener('pagehide', this.onLeaveApp);
    window.addEventListener('keydown', this.onNavigationKey);
    this.events.once('shutdown', this.cleanup, this);

    void this.loadAndStart();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.player || this.paused) {
      return;
    }
    if (this.runStarted && !this.runEnded) this.runElapsedMs += deltaMs;
    this.player.update(deltaMs);

    // The tap-to-start gate lifts the instant Player's own jump-input
    // listener flips `isWaitingToStart` off (see Player.onJumpPressed) —
    // polled here rather than a duplicate event listener, since Player
    // already owns deciding what counts as "the start tap".
    if (!this.runStarted && !this.player.isWaitingToStart) {
      this.runStarted = true;
      this.tapToStartPrompt.hide();
      this.runElapsedMs = 0;
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

    // A bat fires the instant its x crosses into view (see BAT_DASH_SPEED_PX's
    // comment on why that's the trigger, not proximity) — checked from the
    // same locally-computed scrollX/visibleWorldWidth used above, not
    // camera.worldView, since that's the one the zoom-pivot gotcha (see
    // memory) warns isn't trustworthy synchronously after a same-tick
    // scrollX change. Gated on runStarted so a bat visible from the spawn
    // viewport doesn't lock on before the tap-to-start gate even lifts,
    // same as every other moving hazard staying paused until then.
    if (this.runStarted && !this.runEnded) {
      const viewRightEdge = this.cameras.main.scrollX + visibleWorldWidth;
      for (const bat of this.bats) {
        if (!bat.triggered && bat.sprite.x <= viewRightEdge) {
          bat.triggered = true;
          triggerBatFlight(bat.sprite, this.player.sprite.x, this.player.sprite.y);
        }
      }
    }

    if (this.runStarted && !this.runEnded && this.player.sprite.y > FALL_DEATH_Y) {
      this.onPlayerDied();
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.onLeaveApp();
  };

  private readonly onLeaveApp = (): void => {
    if (!this.runEnded) this.pauseRun();
  };

  private readonly onNavigationKey = (event: KeyboardEvent): void => {
    if (event.repeat || !this.player) return;
    // Dev shortcut: warp to the finish sprite, then trigger the real finish
    // sequence (particles, camera flash, bell animation, player's dance,
    // result overlay) there — triggering in place left the camera (which
    // just follows the player's x) nowhere near the bell. Dev subreddit
    // only: anywhere else it would verify unbeaten levels and farm clears.
    if (event.key === '7' && currentSubredditName() === DEV_SUBREDDIT) {
      event.preventDefault();
      if (this.finishSprite) {
        this.player.reset(this.finishSprite.x, this.finishSprite.y, false);
      }
      this.onFinishReached();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (this.paused) this.resumeRun();
    else this.pauseRun();
  };

  private pauseRun(): void {
    if (!this.player || this.paused) return;
    this.paused = true;
    this.player.clearBufferedInput();
    this.input.keyboard?.resetKeys();
    // Pause synchronously: a hidden tab may not get another frame to
    // process ScenePlugin's queued pause operation until it is visible.
    this.sys.pause();
    this.controls.showPaused(this.runEnded);
  }

  private resumeRun(): void {
    if (!this.paused || document.hidden) return;
    this.player?.clearBufferedInput();
    this.input.keyboard?.resetKeys();
    this.paused = false;
    this.controls.hideDialog();
    // Phaser's TweenManager uses wall time independently of scene delta.
    // Consume the paused interval without stepping hazards or effects.
    this.tweens.getDelta(true);
    this.sys.resume();
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
              extendByTiles: previewReturn.extendByTiles,
              removeObjectId: previewReturn.removeObjectId,
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

    this.levelRequest?.abort();
    // No "Loading level…" screen: the first level was already fetched under
    // the Preloader's bar, and a later one (Next Level, Browse) is a short
    // wait on the dark canvas. Failures still get the error dialog below.
    this.controls.hideWhileLoading();
    const levelId = this.explicitLevelId ?? getRequestedLevelId();
    const request = new AbortController();
    this.levelRequest = request;
    const prefetched = await takePrefetchedLevel(levelId);
    if (request.signal.aborted) return;

    // A single transient failure (serverless cold start, a dropped packet)
    // used to surface "Could not load this level" immediately and make the
    // player tap Retry themselves for something that was never really
    // broken — a couple of quick, silent retries absorb that before ever
    // showing an error, so the loading spinner just holds a beat longer
    // instead of flashing a false failure.
    const LOAD_ATTEMPTS = 3;
    let levelVersion: LevelVersion | undefined = prefetched;
    let lastError: unknown;
    for (let attempt = 1; !levelVersion && attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(
          `/api/levels/${encodeURIComponent(levelId)}`,
          { signal: withTimeout(request.signal, 15000) }
        );
        if (!response.ok) {
          throw new Error(`Level request failed: ${response.status}`);
        }
        const body: unknown = await response.json();
        if (!isLevelVersion(body)) {
          throw new Error(`Unexpected level response for "${levelId}"`);
        }
        levelVersion = body;
        break;
      } catch (error) {
        if (request.signal.aborted) return;
        lastError = error;
        if (attempt < LOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          if (request.signal.aborted) return;
        }
      }
    }
    if (!levelVersion) {
      console.error(`Failed to load level "${levelId}":`, lastError);
      this.controls.showLoadError();
      return;
    }

    if (request.signal.aborted) return;
    this.levelRequest = undefined;
    this.levelVersion = levelVersion;
    this.subscribeRealtime(levelVersion.levelId);
    void this.loadLevelStats(levelVersion.levelId);
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
    this.controls.hideDialog();
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
    this.bats = loaded.bats;
    this.finishSprite = loaded.finishSprite;
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
    if (document.hidden) this.pauseRun();
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
    if (this.finishSprite) {
      playFinishBellAnimation(this, this.finishSprite);
    }
    playSfx(this, 'clear');

    const timeMs = Math.max(1, Math.round(this.runElapsedMs));
    this.resultOverlay.showTime();

    if (this.previewLevel && this.candidateToken) {
      void this.submitVerification(this.candidateToken, timeMs);
    } else {
      const levelVersion = this.levelVersion;
      this.resultOverlay.setShareHandler(() => this.share(this.clearShareText()));
      this.resultOverlay.setLeaderboardHandler(() =>
        LeaderboardOverlay.instance().show({ levelId: levelVersion.levelId })
      );
      const request: SubmitRunRequest = {
        levelId: levelVersion.levelId,
        version: levelVersion.version,
        timeMs,
        submissionId: crypto.randomUUID(),
      };
      void this.submitRun(request);
      void this.findNextLevel();
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
    const attempt = this.attempt;
    this.resultOverlay.showSaveStatus('Verifying clear…');
    let verified: boolean;
    try {
      const response = await fetch('/api/publish/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken, timeMs }),
        signal: withTimeout(attempt.signal, 15000),
      });
      const json: unknown = await response.json();
      verified = response.ok && isVerifyLevelResponse(json) && json.status === 'ok';
    } catch {
      verified = false;
    }

    if (attempt.signal.aborted) return;
    if (!verified) {
      this.resultOverlay.showSaveStatus('Could not verify your clear. Retry verification or return to the editor.',
        () => void this.submitVerification(candidateToken, timeMs));
      return;
    }
    this.resultOverlay.showSaveStatus('Clear verified.');
    if (previewReturn?.kind === 'curse') {
      void this.publishCurseAndReturn(candidateToken, previewReturn);
      return;
    }

    const returnObjects =
      previewReturn?.kind === 'editor' ? previewReturn.objects : [];
    this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
      if (attempt.signal.aborted) return;
      this.scene.start('EditorScene', {
        objects: returnObjects,
        verifiedCandidateToken: candidateToken,
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
    const attempt = this.attempt;
    this.resultOverlay.showSaveStatus('Publishing curse…');
    let message = 'Could not publish your curse — please try again.';
    let conflict = false;
    let published = false;
    try {
      const response = await fetch('/api/curse/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken }),
        signal: withTimeout(attempt.signal, 15000),
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

    if (attempt.signal.aborted) return;
    this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
      if (attempt.signal.aborted) return;
      if (published) {
        this.scene.start('GameScene', { levelId: previewReturn.levelId });
        return;
      }
      this.scene.start('CurseScene', {
        levelId: previewReturn.levelId,
        preselected: conflict
          ? undefined
          : {
              category: previewReturn.category,
              object: previewReturn.object,
              extendByTiles: previewReturn.extendByTiles,
              removeObjectId: previewReturn.removeObjectId,
            },
        message,
      });
    });
  }

  private async submitRun(request: SubmitRunRequest): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    const attempt = this.attempt;
    this.resultOverlay.showSaveStatus('Saving score…');
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: withTimeout(attempt.signal, 15000),
      });
      if (attempt.signal.aborted) return;
      if (response.status === 401) {
        this.resultOverlay.showSaveStatus('Sign in to Reddit to save scores. You can still replay or browse.');
        return;
      }
      const body: unknown = await response.json();
      if (!response.ok || !isSubmitRunResponse(body)) throw new Error('Score was not saved');
      if (attempt.signal.aborted) return;
      this.resultOverlay.showResult(body);
      this.resultOverlay.showSaveStatus('');
      this.resultOverlay.setCurseHandler(() =>
        this.scene.start('CurseScene', { levelId: request.levelId })
      );
    } catch {
      if (attempt.signal.aborted) return;
      this.resultOverlay.showSaveStatus(
        'Could not confirm your score was saved. Retry saving before leaving this result.',
        () => void this.submitRun(request)
      );
    } finally {
      if (!attempt.signal.aborted) this.submitting = false;
    }
  }

  private async findNextLevel(): Promise<void> {
    if (this.findingNext) return;
    this.findingNext = true;
    const attempt = this.attempt;
    this.resultOverlay.showNext('Finding another level…');
    try {
      const response = await fetch('/api/discovery/levels?sort=new', {
        signal: withTimeout(attempt.signal, 15000),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isDiscoveryResponse(body)) throw new Error('Could not find levels');
      if (attempt.signal.aborted) return;
      const currentIndex = body.levels.findIndex((level) => level.levelId === this.levelVersion?.levelId);
      const next = body.levels.slice(currentIndex + 1)
        .concat(body.levels.slice(0, Math.max(0, currentIndex)))
        .find((level) => level.levelId !== this.levelVersion?.levelId);
      if (next) {
        this.resultOverlay.showNext(`Up next: ${next.title}`, 'Next Level', () =>
          this.scene.start('GameScene', { levelId: next.levelId })
        );
      } else {
        this.resultOverlay.showNext('');
      }
    } catch {
      if (!attempt.signal.aborted) {
        this.resultOverlay.showNext('Could not find the next level.', 'Retry Next Level', () => void this.findNextLevel());
      }
    } finally {
      if (!attempt.signal.aborted) this.findingNext = false;
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
      case 'shield':
        this.player.grantShield();
        break;
      case 'speedBoost':
        this.player.applySpeedBoost();
        break;
      default:
        break;
    }
    playSfx(this, 'pickup');
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
    this.deathsThisLevel++;
    if (objectId) {
      this.reportHazardDeath(objectId);
    } else {
      this.deathPanel.show();
    }
    const killer = objectId
      ? this.levelVersion?.objects.find((o) => o.id === objectId)
      : undefined;
    const attributedKiller = killer?.addedBy === SEED_AUTHOR ? undefined : killer;
    this.deathPanel.setShareHandler(
      this.previewLevel
        ? undefined
        : () => this.share(this.deathShareText(attributedKiller))
    );
    this.player.die();
  }

  // Title + canonical post for sharing. Best-effort: without it the share
  // sheet still works, falling back to the level id and the current post.
  private async loadLevelStats(levelId: string): Promise<void> {
    // Not tied to `this.attempt`: a quick death/restart aborts that, and
    // the stats should still arrive. The levelId check below drops a
    // response that lands after the scene moved to another level.
    try {
      const response = await fetch(
        `/api/discovery/stats/${encodeURIComponent(levelId)}`,
        { signal: withTimeout(new AbortController().signal, 8000) }
      );
      const body: unknown = await response.json();
      if (response.ok && isLevelStats(body) && this.levelVersion?.levelId === levelId) {
        this.levelStats = body;
      }
    } catch {
      // Sharing falls back to the level id — nothing to surface.
    }
  }

  private levelName(): string {
    return (
      this.levelStats?.title ??
      this.levelVersion?.levelId.replaceAll('-', ' ') ??
      'this level'
    );
  }

  private deathShareText(killer: LevelObject | undefined): string {
    const n = this.deathsThisLevel;
    const cause = killer
      ? `u/${killer.addedBy}'s ${labelFor(killer.type)} got me on "${this.levelName()}"`
      : `"${this.levelName()}" got me`;
    return `${cause}. ${n} ${n === 1 ? 'death' : 'deaths'} and counting 💀 Think you can do better?`;
  }

  private clearShareText(): string {
    const n = this.deathsThisLevel;
    const rate = this.levelStats ? ` (${clearRateText(this.levelStats)})` : '';
    const effort =
      n === 0 ? 'on my first try' : `after ${n} ${n === 1 ? 'death' : 'deaths'}`;
    return `I beat "${this.levelName()}"${rate} ${effort}. Your turn 😈`;
  }

  // Native share sheet on mobile, clipboard on desktop. Targets the level's
  // own post when it has one, else the post this game is running in.
  private share(text: string): void {
    const postId = this.levelStats?.postId;
    showShareSheet({
      title: `CURSED: ${this.levelName()}`,
      text,
      post: postId !== undefined && isPostId(postId) ? postId : undefined,
    }).catch(() => undefined);
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

    const attempt = this.attempt;
    const request: TrapKillRequest = { levelId, version, objectId };
    fetch('/api/runs/trap-kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: attempt.signal,
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json: unknown) => {
        if (!attempt.signal.aborted && attributedAuthor !== undefined && isTrapKillResponse(json)) {
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
    this.attempt.abort();
    this.attempt = new AbortController();
    this.submitting = false;
    this.findingNext = false;
    this.tweens.killTweensOf(this.player.sprite);
    this.resumeRun();
    this.controls.hideDialog();
    this.resultOverlay.hide();
    this.deathPanel.hide();
    this.tapToStartPrompt.hide();
    this.player.reset(this.spawn.x, this.spawn.y);
    this.cameras.main.scrollX = 0;
    this.runElapsedMs = 0;
    this.runStarted = true;
    this.physics.resume();
    this.runEnded = false;

    // Power-ups are re-collectible each attempt (spec section 21's
    // pickups are deterministic, not consumed forever) — the world
    // persists across a same-scene restart, so collected ones must be
    // brought back by hand rather than by reloading the level.
    for (const image of this.powerUpImages) {
      setPowerUpAvailable(image, true);
    }
    this.resetMovingObjects?.();

    // Defensive: onFinishReached leaves runEnded=true, and every normal
    // path out of a finish is the result overlay's next-level/editor-return
    // flow rather than restartRun — but if this ever does fire after a
    // finish (e.g. a stray restart control), the bell shouldn't stay stuck
    // mid-ding.
    if (this.finishSprite) {
      this.tweens.killTweensOf(this.finishSprite);
      this.finishSprite.setRotation(0);
      setFinishFrame(this.finishSprite, 'finish-idle');
    }
  }

  private cleanup(): void {
    this.attempt.abort();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('blur', this.onLeaveApp);
    window.removeEventListener('pagehide', this.onLeaveApp);
    window.removeEventListener('keydown', this.onNavigationKey);
    this.controls.destroy();
    LeaderboardOverlay.instance().hide();
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
