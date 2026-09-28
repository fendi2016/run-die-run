import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import {
  connectRealtime,
  disconnectRealtime,
  showShareSheet,
} from '@devvit/web/client';
import type { T3 } from '@devvit/web/shared';
import {
  CURSE_LOCKED_LEVEL_IDS,
  DEV_SUBREDDIT,
  HUB_LEVEL_ID,
  STARTER_LEVEL_ID,
  STRUGGLE_DEATHS,
  STRUGGLE_MAX_PROGRESS,
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
  type FallDeathRequest,
  type SubmitRunRequest,
  type TrapKillRequest,
} from '../../../shared/runsApi';
import {
  isLevelVersion,
  type LevelObject,
  type LevelVersion,
  type ObjectType,
} from '../../../shared/types';
import { DeathToast } from '../../ui/DeathToast';
import { DiscoveryOverlay } from '../../ui/DiscoveryOverlay';
import { LeaderboardOverlay } from '../../ui/LeaderboardOverlay';
import { labelFor } from '../../../shared/objectLabels';
import { PreviewBackButton } from '../../ui/PreviewBackButton';
import { StarterOffer } from '../../ui/StarterOffer';
import { RealtimeToast } from '../../ui/RealtimeToast';
import { RunHud, loadBestProgress, saveBestProgress } from '../../ui/RunHud';
import { RunResultOverlay } from '../../ui/RunResultOverlay';
import { drawGroundDetail, drawKenneyScenery, drawPaperBackdrop } from '../systems/PaperScenery';
import { TapToStartPrompt } from '../../ui/TapToStartPrompt';
import { TutorialHint } from '../../ui/TutorialHint';
import { clearRateText } from '../../ui/levelStatsText';
import {
  FINISH_RESTART_DELAY_MS,
  RESPAWN_DELAY_MS,
  RESPAWN_SKIP_AFTER_MS,
  PLAYER_SCREEN_ANCHOR,
  CAMERA_ZOOM_BOOST,
  CAMERA_FOLLOW_Y_LERP,
  CAMERA_PLAYER_Y_ANCHOR,
  SPAWN_TOMBSTONE_HEIGHT_PX,
  PLAYER_SIZE,
} from '../constants';
import { Player } from '../entities/Player';
import { JUMP_DOWN_EVENT } from '../systems/InputSystem';
import { PhysicsInterpolation } from '../systems/PhysicsInterpolation';
import { getRequestedLevelId } from '../levelSelection';
import { TUTORIAL_LEVEL, hintAt, markTutorialDone } from '../levels/tutorial';
import { takePrefetchedLevel } from '../levelPrefetch';
import {
  playScribbleIn,
  burstParticles,
  playFinishGateAnimation,
  playPixelFx,
  stopFinishGateAnimation,
} from '../systems/Juice';
import { drawDeathMarkers, fetchDeathMarkers, reportDeathPosition } from '../systems/DeathMarkers';
import { playSfx } from '../systems/Sfx';
import { loadLevel, setPowerUpAvailable, type LoadedBat } from '../systems/LevelLoader';
import { ensurePlaceholderTextures } from '../systems/PlaceholderTextures';
import { triggerBatFlight } from '../objects/ObjectRegistry';

const FALLBACK_SPAWN = { x: 80, y: LOGICAL_HEIGHT - 200 };
// The scribble-in (Juice.playScribbleIn): on level load the player is
// hidden while the scrawl draws and appears as it finishes; a retry starts
// running at once, so it gets a quicker flourish around the visible player.
const SPAWN_SCRIBBLE_MS = 260;
const SPAWN_SCRIBBLE_RETRY_MS = 150;
const SPAWN_SCRIBBLE_WIDTH = PLAYER_SIZE * 0.6;
// Offsets from the finish gate's top-center, in world px.
const FINISH_FIREWORKS = [
  { key: 'firework-green', dx: -40, dy: -40, delayMs: 0 },
  { key: 'firework-yellow', dx: 50, dy: -70, delayMs: 200 },
  { key: 'firework-green', dx: 10, dy: -110, delayMs: 400 },
] as const;

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
  // With `tutorial`, `levelId` is where to go once it's done or skipped.
  levelId?: string;
  tutorial?: boolean;
  // Set on the starter: where Next Level leads (Level of the Day after the
  // tutorial, or back to the level the player was struggling on).
  returnTo?: { levelId: string; title: string };
};

// Levels the starter has already been offered on this session.
const starterOfferedOn = new Set<string>();

// Level-format phase (spec section 38, Phase 3): levels are fetched from
// the server as data (LevelVersion) and built through the ObjectRegistry /
// LevelLoader, instead of the Phase 1/2 hardcoded ground/hazard layout.
// A local guard rather than @devvit/web/shared's isT3, so the client
// bundle only takes a type from that package, not its runtime.
function isPostId(id: string): id is T3 {
  return id.startsWith('t3_');
}

// How far above the canvas's bottom edge a fall-death skull sits.
const FALL_SKULL_INSET_PX = 4;

// The tap-to-start prompt shows exactly one instruction at a time (never
// alongside a second "how to play" line, and never alongside TutorialHint —
// see startRun() and update()). A tutorial run uses its own first hint
// instead of this generic line.
const TAP_TO_START_MESSAGE = 'Tap to start · hold to jump higher';

export class GameScene extends Scene {
  private player: Player | undefined;
  private resultOverlay!: RunResultOverlay;
  private deathToast!: DeathToast;
  private runHud!: RunHud;
  // Other players' deaths on this version load in the background; aborted
  // on shutdown so a late response never draws into a dead scene.
  private markersRequest: AbortController | undefined;
  // Best distance this viewer has reached on this level version, 0..1
  // (null on a preview run, which never records one).
  private bestProgress: number | null = null;
  // Pending auto-respawn after a death, and when that death happened (in
  // scene time, so pausing mid-death doesn't count toward the skip floor).
  private respawnTimer: Phaser.Time.TimerEvent | undefined;
  private diedAt = 0;
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
  // Smooths the player and bats between fixed physics steps (see
  // PhysicsInterpolation); rebuilt with each startRun().
  private interpolation: PhysicsInterpolation | undefined;
  private finishSprite: Phaser.GameObjects.Sprite | undefined;

  private previewLevel: LevelVersion | undefined;
  private candidateToken: string | undefined;
  private previewReturn: PreviewReturn | undefined;
  private explicitLevelId: string | undefined;
  private tutorial = false;
  private returnTo: { levelId: string; title: string } | undefined;
  private tutorialHint!: TutorialHint;

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
    this.tutorial = data.tutorial === true;
    this.returnTo = data.returnTo;
    // The tutorial runs as a preview so nothing about it is reported or
    // saved (deaths, best distance, share); it only differs at load and at
    // the finish.
    this.previewLevel = this.tutorial ? TUTORIAL_LEVEL : data.previewLevel;
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
    this.interpolation = undefined;
    this.finishSprite = undefined;
    this.pendingVersionPublished = undefined;
    this.pendingWorldRecord = undefined;
    this.deathsThisLevel = 0;
    this.levelStats = undefined;
  }

  create(): void {
    ensurePlaceholderTextures(this);
    this.cameras.main.setBackgroundColor(0xfbf8ef);
    this.applyResponsiveZoom();
    this.scale.on('resize', this.applyResponsiveZoom, this);

    this.resultOverlay = new RunResultOverlay();
    this.deathToast = new DeathToast();
    this.runHud = new RunHud();
    this.tutorialHint = new TutorialHint();
    this.events.on(JUMP_DOWN_EVENT, this.onJumpDownWhileDead, this);
    this.tapToStartPrompt = new TapToStartPrompt();
    this.controls = new GameplayControls({
      pause: () => this.pauseRun(),
      resume: () => this.resumeRun(),
      restart: () => this.restartRun(),
      retryLoad: () => void this.loadAndStart(),
      menu: () => this.scene.start('MainMenu'),
      browse: () => this.openBrowse(),
    }, Boolean(this.previewLevel));
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onLeaveApp);
    window.addEventListener('pagehide', this.onLeaveApp);
    window.addEventListener('keydown', this.onNavigationKey);
    // Registered after ArcadePhysics' own listeners (added on scene start,
    // before create), so POST_UPDATE here runs once Arcade has already
    // written this frame's steps back to the sprites.
    this.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate, this);
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

    // A bat fires the instant its x crosses into view (see BAT_DASH_SPEED_PX's
    // comment on why that's the trigger, not proximity) — checked from the
    // locally computed scroll for the player's true position, not
    // camera.worldView, since that's the one the zoom-pivot gotcha (see
    // memory) warns isn't trustworthy synchronously after a same-tick
    // scrollX change. Gated on runStarted so a bat visible from the spawn
    // viewport doesn't lock on before the tap-to-start gate even lifts,
    // same as every other moving hazard staying paused until then.
    if (this.runStarted && !this.runEnded) {
      const viewRightEdge =
        this.cameraScrollXFor(this.player.sprite.x) + this.visibleWorldWidth();
      for (const bat of this.bats) {
        if (!bat.triggered && bat.sprite.x <= viewRightEdge) {
          bat.triggered = true;
          triggerBatFlight(bat.sprite, this.player.sprite.x, this.player.sprite.y);
        }
      }
    }

    if (this.runStarted && !this.runEnded) {
      this.runHud.setProgress(this.currentProgress());
    }
    // Only takes over once the tap-to-start gate has lifted — while
    // waiting, the tutorial's first hint is already showing as the
    // tap-to-start prompt's own single line (see startRun()), so this
    // stays hidden rather than doubling it up on screen.
    if (this.tutorial) {
      this.tutorialHint.set(this.runStarted && !this.runEnded ? hintAt(this.player.sprite.x) : '');
    }

    if (this.runStarted && !this.runEnded && this.player.sprite.y > FALL_DEATH_Y) {
      this.onPlayerDied();
    }
  }

  private onPreUpdate(): void {
    this.interpolation?.restore();
  }

  // Drawing happens right after this, so the camera follows the player's
  // interpolated position — following the stepped one (or, as it used to,
  // reading sprite.x in update() before Arcade had moved it this frame)
  // shook the player on screen whenever a frame ran zero or two steps.
  private onPostUpdate(): void {
    if (!this.player) return;
    this.interpolation?.apply();
    this.player.syncVisuals();
    // centerOnX, not scrollX: with zoom != 1 scrollX isn't the left edge
    // (zoom-pivot gotcha), which pushed the player off-screen in portrait.
    this.cameras.main.centerOnX(
      this.cameraScrollXFor(this.player.sprite.x) + this.visibleWorldWidth() / 2
    );
    this.followPlayerY(false);
  }

  // Centre-based (centerOnY), not scrollY, per the zoom-pivot gotcha; the
  // camera bounds clamp it so the ground row never leaves the screen.
  private cameraCenterY = LOGICAL_HEIGHT / 2;
  private followPlayerY(snap: boolean): void {
    if (!this.player) return;
    const visibleHeight = LOGICAL_HEIGHT / this.zoomBoost();
    const target = Phaser.Math.Clamp(
      this.player.sprite.y + visibleHeight * (0.5 - CAMERA_PLAYER_Y_ANCHOR),
      visibleHeight / 2,
      LOGICAL_HEIGHT - visibleHeight / 2
    );
    this.cameraCenterY = snap
      ? target
      : Phaser.Math.Linear(this.cameraCenterY, target, CAMERA_FOLLOW_Y_LERP);
    this.cameras.main.centerOnY(this.cameraCenterY);
  }

  // Vertical zoom is locked to LOGICAL_HEIGHT / CAMERA_ZOOM_BOOST (see applyResponsiveZoom),
  // so the world-space width actually on screen varies with device
  // aspect ratio — narrower on a tall phone, wider on a desktop.
  private visibleWorldWidth(): number {
    return this.scale.width / this.cameras.main.zoom;
  }

  private cameraScrollXFor(playerX: number): number {
    const visibleWorldWidth = this.visibleWorldWidth();
    return Phaser.Math.Clamp(
      playerX - visibleWorldWidth * PLAYER_SCREEN_ANCHOR,
      0,
      Math.max(0, this.levelWidth - visibleWorldWidth)
    );
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
    // sequence (particles, camera flash, gate animation, player's dance,
    // result overlay) there — triggering in place left the camera (which
    // just follows the player's x) nowhere near the gate. Dev subreddit
    // only: anywhere else it would verify unbeaten levels and farm clears.
    if (event.key === '7' && currentSubredditName() === DEV_SUBREDDIT) {
      event.preventDefault();
      if (this.finishSprite) {
        this.player.reset(this.finishSprite.x, this.finishSprite.y, false);
      }
      this.onFinishReached(true);
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
    this.cameras.main.setZoom(
      (this.scale.height / LOGICAL_HEIGHT) * this.zoomBoost()
    );
  }

  // Landscape only: a portrait screen is already narrow in world px, and
  // zooming further would leave only a few tiles of warning ahead.
  private zoomBoost(): number {
    return this.scale.width >= this.scale.height ? CAMERA_ZOOM_BOOST : 1;
  }

  private async loadAndStart(): Promise<void> {
    if (this.tutorial) {
      this.levelVersion = TUTORIAL_LEVEL;
      this.startRun(TUTORIAL_LEVEL);
      PreviewBackButton.instance().setLabel('Skip Tutorial →');
      PreviewBackButton.instance().setOnBack(() => this.leaveTutorial());
      PreviewBackButton.instance().show();
      return;
    }
    if (this.previewLevel) {
      this.levelVersion = this.previewLevel;
      this.startRun(this.previewLevel);
      const previewReturn = this.previewReturn;
      const backToEditor = (): void => {
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
      };
      // Deaths don't stop on a panel any more, so both the editor's Test
      // run and a curse's Prove It run use the top-left button.
      PreviewBackButton.instance().setLabel('← Back to Editor');
      PreviewBackButton.instance().setOnBack(backToEditor);
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
      onPowerUpCollected: (type, x, y) => this.onPowerUpCollected(type, x, y),
    });

    this.spawn = loaded.spawn;
    this.levelWidth = loaded.levelWidth;
    this.movingObjectTweens = loaded.movingObjectTweens;
    this.resetMovingObjects = loaded.resetMovingObjects;
    this.powerUpImages = loaded.powerUpImages;
    this.bats = loaded.bats;
    this.finishSprite = loaded.finishSprite;
    this.bestProgress = this.previewLevel
      ? null
      : loadBestProgress(levelVersion.levelId, levelVersion.version);
    this.runHud.setAttempt(this.deathsThisLevel + 1);
    this.runHud.setProgress(0);
    this.runHud.setBest(this.bestProgress);
    this.runHud.show();
    if (!this.previewLevel) this.loadDeathMarkers(levelVersion);
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
    drawPaperBackdrop(this, this.levelWidth);
    drawKenneyScenery(this, this.levelWidth, levelVersion.objects, levelVersion.levelId);
    drawGroundDetail(this, levelVersion.objects, levelVersion.levelId);

    // The spawn tombstone the player rises from — above the background, behind
    // the player and every level object.
    this.add
      .image(this.spawn.x, this.spawn.y, 'spawn-marker')
      .setOrigin(0.5, 1)
      .setScale(SPAWN_TOMBSTONE_HEIGHT_PX / this.textures.getFrame('spawn-marker').height)
      .setDepth(-0.25);

    // waiting=true: hold at spawn (idle, no auto-run) until the first tap
    // — update() starts the timer and hides the prompt once Player itself
    // reports the wait is over.
    player.reset(this.spawn.x, this.spawn.y, true);
    this.followPlayerY(true);
    this.playSpawnWarp(true);
    // Keep gravity, collision callbacks, and moving objects idle together.
    // Scene input remains active so the first tap can release the gate.
    this.physics.pause();
    for (const tween of this.movingObjectTweens) {
      tween.pause();
    }
    // The tutorial's own first hint doubles as the tap-to-start line, so
    // there's only ever one instruction on screen — never this prompt's
    // generic line *and* TutorialHint at the same time (see update()).
    this.tapToStartPrompt.show(this.tutorial ? hintAt(player.sprite.x) : TAP_TO_START_MESSAGE);
    this.interpolation?.destroy();
    this.interpolation = new PhysicsInterpolation(this, [
      player.sprite,
      ...this.bats.map((bat) => bat.sprite),
    ]);
    if (document.hidden) this.pauseRun();
  }

  // `devWarp`: reached via the dev '7' key — plays the whole finish
  // sequence but saves nothing, so testing never inflates a level's clears
  // or verifies a level nobody beat.
  private onFinishReached(devWarp = false): void {
    if (this.runEnded || !this.player || !this.levelVersion) {
      return;
    }
    this.runEnded = true;
    this.player.freeze();
    this.recordBestProgress(1);
    this.runHud.hide();

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
      playFinishGateAnimation(this, this.finishSprite);
      this.playFinishFireworks(this.finishSprite);
    }
    playSfx(this, 'clear');

    const timeMs = Math.max(1, Math.round(this.runElapsedMs));
    this.resultOverlay.showTime();

    if (this.tutorial) {
      PreviewBackButton.instance().hide();
      this.resultOverlay.showSaveStatus('Tutorial complete! Now for a real one…');
      // A Restart from the pause menu aborts the attempt; don't then yank
      // the player out of the new run.
      const attempt = this.attempt;
      this.time.delayedCall(FINISH_RESTART_DELAY_MS, () => {
        if (!attempt.signal.aborted) this.leaveTutorial();
      });
    } else if (devWarp) {
      this.resultOverlay.showSaveStatus('Dev warp: this clear was not saved.');
    } else if (this.previewLevel && this.candidateToken) {
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
      // The starter stays easy forever — no curse offered on it.
      if (!CURSE_LOCKED_LEVEL_IDS.has(request.levelId)) {
        this.resultOverlay.setCurseHandler(() =>
          this.scene.start('CurseScene', { levelId: request.levelId })
        );
      }
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
    if (this.returnTo) {
      const { levelId, title } = this.returnTo;
      const label = levelId === HUB_LEVEL_ID ? 'Next Level' : `Back to ${title}`;
      this.resultOverlay.showNext(`Up next: ${title}`, label, () =>
        this.scene.start('GameScene', { levelId })
      );
      return;
    }
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

  // Pixel burst left where the pickup was, not following the player.
  private onPowerUpCollected(type: ObjectType, x: number, y: number): void {
    if (!this.player) {
      return;
    }
    switch (type) {
      case 'shield':
        this.player.grantShield();
        playPixelFx(this, 'pickup-sparkle', x, y, { scale: 2 });
        break;
      case 'speedBoost':
        this.player.applySpeedBoost();
        playPixelFx(this, 'pickup-flash', x, y, { scale: 0.75 });
        break;
      default:
        break;
    }
    playSfx(this, 'pickup');
  }

  // `objectId` is absent for a fall-death (running off the level, not a
  // placed hazard) — nothing to attribute in that case. Either way the run
  // respawns on its own (see RESPAWN_DELAY_MS).
  private onPlayerDied(objectId?: string): void {
    if (this.runEnded || !this.player) {
      return;
    }
    this.runEnded = true;
    this.deathsThisLevel++;
    if (objectId) {
      this.reportHazardDeath(objectId);
    } else {
      this.deathToast.show();
      this.reportFallDeath();
    }
    const killer = objectId
      ? this.levelVersion?.objects.find((o) => o.id === objectId)
      : undefined;
    const attributedKiller = killer?.addedBy === SEED_AUTHOR ? undefined : killer;
    this.controls.setShareHandler(
      this.previewLevel
        ? undefined
        : () => this.share(this.deathShareText(attributedKiller))
    );
    this.recordBestProgress(this.currentProgress());
    this.maybeOfferStarter();
    this.markDeath();
    this.player.die(killer?.type);
    this.diedAt = this.time.now;
    this.respawnTimer?.remove();
    this.respawnTimer = this.time.delayedCall(RESPAWN_DELAY_MS, () => this.restartRun());
  }

  private loadDeathMarkers(level: LevelVersion): void {
    this.markersRequest?.abort();
    const request = new AbortController();
    this.markersRequest = request;
    fetchDeathMarkers(level.levelId, level.version, request.signal)
      .then((markers) => {
        if (!request.signal.aborted) drawDeathMarkers(this, markers);
      })
      .catch(() => {
        // Best-effort decoration — the level plays the same without it.
      });
  }

  // A skull where you just died, drawn at once so it's there on the next
  // attempt, and reported so other players see it too (not on a preview
  // run — that version isn't public yet). A fall dies far below the
  // screen, so its skull sits at the bottom of the pit instead.
  private markDeath(): void {
    if (!this.player) return;
    const x = this.player.sprite.x;
    const y = Math.min(this.player.sprite.y, LOGICAL_HEIGHT - FALL_SKULL_INSET_PX);
    drawDeathMarkers(this, [{ x, y, count: 1 }]);
    const level = this.levelVersion;
    if (this.previewLevel || !level) return;
    reportDeathPosition({ levelId: level.levelId, version: level.version, x, y });
  }

  // Done or skipped: never shown again on this device; carry on to the
  // level the player asked for in the first place.
  // A hub post (no level of its own) warms up on the starter before Level
  // of the Day; a level post goes straight to its level.
  private leaveTutorial(): void {
    markTutorialDone();
    const destination = this.explicitLevelId ?? getRequestedLevelId();
    if (destination === HUB_LEVEL_ID) {
      this.scene.start('GameScene', {
        levelId: STARTER_LEVEL_ID,
        returnTo: { levelId: HUB_LEVEL_ID, title: "Today's level" },
      });
      return;
    }
    this.scene.start('GameScene', { levelId: this.explicitLevelId });
  }

  // Repeated early deaths on a community level: offer the starter once,
  // coming back here afterwards.
  private maybeOfferStarter(): void {
    const level = this.levelVersion;
    if (
      !level || this.previewLevel || this.returnTo ||
      CURSE_LOCKED_LEVEL_IDS.has(level.levelId) || starterOfferedOn.has(level.levelId) ||
      this.deathsThisLevel < STRUGGLE_DEATHS ||
      (this.bestProgress ?? 0) >= STRUGGLE_MAX_PROGRESS
    ) {
      return;
    }
    starterOfferedOn.add(level.levelId);
    const title = this.levelStats?.title ?? level.levelId;
    StarterOffer.instance().show(() =>
      this.scene.start('GameScene', {
        levelId: STARTER_LEVEL_ID,
        returnTo: { levelId: level.levelId, title },
      })
    );
  }

  // How far along the level the player is, 0 at the spawn and 1 at the
  // finish gate.
  private currentProgress(): number {
    if (!this.player || !this.finishSprite) return 0;
    const span = this.finishSprite.x - this.spawn.x;
    if (span <= 0) return 0;
    return Phaser.Math.Clamp((this.player.sprite.x - this.spawn.x) / span, 0, 1);
  }

  private recordBestProgress(progress: number): void {
    const level = this.levelVersion;
    if (this.previewLevel || !level) return;
    if (this.bestProgress !== null && progress <= this.bestProgress) return;
    this.bestProgress = progress;
    saveBestProgress(level.levelId, level.version, progress);
    this.runHud.setBest(progress);
  }

  // Any jump input shortly after dying skips the rest of the respawn wait.
  // Only while dead: a finish also ends the run but waits on its own
  // result screen.
  private onJumpDownWhileDead(): void {
    if (!this.respawnTimer || this.paused) return;
    if (this.time.now - this.diedAt < RESPAWN_SKIP_AFTER_MS) return;
    // Deferred until this emit has finished: Player listens to the same
    // event (registered after this one), and reviving it first would let
    // the skip tap also queue a jump at the spawn.
    queueMicrotask(() => {
      if (this.respawnTimer) this.restartRun();
    });
  }

  // Counts a fall as an attempt (no trap to credit). Best-effort, never
  // delays the death panel or Retry.
  private reportFallDeath(): void {
    const levelId = this.levelVersion?.levelId;
    if (this.previewLevel || !levelId) return;
    const request: FallDeathRequest = { levelId };
    fetch('/api/runs/fall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      // Not tied to this.attempt: a quick Retry aborts that and would drop
      // the report before it reached the server. Nothing reads the reply.
      keepalive: true,
    }).catch(() => {
      // Only a stats counter — nothing to surface.
    });
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
      title: `SKETCHY: ${this.levelName()}`,
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
      this.deathToast.show();
      return;
    }

    const attributedAuthor =
      object.addedBy === SEED_AUTHOR ? undefined : object.addedBy;
    const toast = this.deathToast;
    const shownToken = toast.show(
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

    // Not tied to `this.attempt`: the auto-respawn aborts that within
    // 600ms, which would drop the kill on a slow response. The toast's
    // token already ignores a count that arrives after a newer death.
    const request: TrapKillRequest = { levelId, version, objectId };
    fetch('/api/runs/trap-kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      keepalive: true,
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json: unknown) => {
        if (attributedAuthor !== undefined && isTrapKillResponse(json)) {
          toast.setKillCount(shownToken, json.kills);
        }
      })
      .catch(() => {
        // Best-effort only — the instant attribution line already showed.
      });
  }

  // The player is scribbled in at the spawn point (see SPAWN_SCRIBBLE_MS).
  private playSpawnWarp(beamIn: boolean): void {
    const sprite = this.player?.sprite;
    if (beamIn) sprite?.setVisible(false);
    playScribbleIn(
      this,
      this.spawn.x,
      this.spawn.y,
      SPAWN_SCRIBBLE_WIDTH,
      PLAYER_SIZE,
      beamIn ? SPAWN_SCRIBBLE_MS : SPAWN_SCRIBBLE_RETRY_MS,
      () => sprite?.setVisible(true)
    );
  }

  // Three staggered pixel fireworks above the finish flag.
  private playFinishFireworks(gate: Phaser.GameObjects.Sprite): void {
    const bounds = gate.getBounds();
    FINISH_FIREWORKS.forEach(({ key, dx, dy, delayMs }) => {
      this.time.delayedCall(delayMs, () =>
        playPixelFx(this, key, bounds.centerX + dx, bounds.top + dy, { scale: 1.5 })
      );
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
    this.respawnTimer?.remove();
    this.respawnTimer = undefined;
    this.tweens.killTweensOf(this.player.sprite);
    this.resumeRun();
    this.controls.hideDialog();
    this.resultOverlay.hide();
    this.tapToStartPrompt.hide();
    this.player.reset(this.spawn.x, this.spawn.y);
    this.followPlayerY(true);
    this.runHud.setAttempt(this.deathsThisLevel + 1);
    this.runHud.setProgress(0);
    this.runHud.show();
    this.playSpawnWarp(false);
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
    // finish (e.g. a stray restart control), the gate shouldn't stay stuck
    // mid-pulse.
    if (this.finishSprite) {
      stopFinishGateAnimation(this, this.finishSprite);
    }
  }

  // Browse opens over the level, not via the main menu: Back closes it and
  // leaves the player on the death / clear / pause screen they came from
  // (it used to route through MainMenu, so Back landed on the menu).
  private openBrowse(): void {
    DiscoveryOverlay.instance().show({
      onSelectLevel: (levelId) => this.scene.start('GameScene', { levelId }),
    });
  }

  private cleanup(): void {
    DiscoveryOverlay.instance().hide();
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
    this.deathToast.hide();
    this.runHud.hide();
    this.tutorialHint.hide();
    StarterOffer.instance().hide();
    this.markersRequest?.abort();
    this.markersRequest = undefined;
    this.events.off(JUMP_DOWN_EVENT, this.onJumpDownWhileDead, this);
    this.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate, this);
    this.interpolation?.destroy();
    this.interpolation = undefined;
    this.respawnTimer = undefined;
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
