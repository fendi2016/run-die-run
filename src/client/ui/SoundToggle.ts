import type * as Phaser from 'phaser';
import { requireButton } from './domUtils';
import { MUSIC_URL, MUSIC_VOLUME, MUTED_KEY, openMusicChannel, readMuted } from './musicHandoff';

// Background music ("Evening Mood") plus the one global mute that also
// silences Phaser's SFX. The music is a plain <audio> element rather than
// a Phaser-loaded sound: it streams instead of blocking the Preloader on a
// 2 MB download, and isn't decoded into ~30 MB of PCM in memory. AAC
// (.m4a), not the delivered .ogg — Ogg Vorbis isn't reliably playable in
// iOS webviews, and the Reddit app is one.

// Set by initSound; the Preloader calls allowMusic() once its assets are in.
let releaseMusic: (() => void) | undefined;

// Held back until the loading bar is done: a 2 MB track downloading
// alongside the Preloader's assets roughly doubles the bar on a slow
// mobile connection. Buffering starts on the menu, before the Play tap.
export function allowMusic(): void {
  releaseMusic?.();
  releaseMusic = undefined;
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Embedded storage can be unavailable — the toggle still works for
    // this session.
  }
}

export function initSound(game: Phaser.Game): void {
  const button = requireButton('sound-toggle');
  const music = new Audio(MUSIC_URL);
  music.loop = true;
  music.volume = MUSIC_VOLUME;
  // Nothing downloads until allowMusic() (see above); from then on it
  // buffers right away so it's ready by the time the player taps — with
  // 'none' until the tap, the run opened on a couple of seconds of silence.
  music.preload = 'none';
  let allowed = false;
  let muted = readMuted();
  // Only real playback counts: the track time has to actually advance.
  // Some webviews report a blocked play() as started (paused=false, even
  // a 'playing' event) while staying silent, and trusting that is what
  // left the music off for good before.
  let playing = false;
  let lastTime = 0;
  // The splash's copy of the track (see musicHandoff.ts): where it was at
  // and when we heard, so our copy picks up at the same spot.
  let splashAt: number | undefined;
  let splashHeardAt = 0;
  const channel = openMusicChannel((message) => {
    if (message.type !== 'time' || playing) return;
    splashAt = message.at;
    splashHeardAt = performance.now();
  });
  music.addEventListener('timeupdate', () => {
    if (!music.paused && music.currentTime !== lastTime && !playing) {
      playing = true;
      // Ours is audible now — the splash's copy can stop.
      channel.post({ type: 'stop' });
      splashAt = undefined;
    }
    lastTime = music.currentTime;
  });
  music.addEventListener('pause', () => {
    playing = false;
  });
  // Bumped on every start attempt so a stale attempt's rejection can't
  // pause a newer one that's already underway.
  let attempt = 0;

  const start = (): void => {
    if (playing || !allowed) return;
    const id = ++attempt;
    // Reset a fake start first — play() on a track that claims to be
    // unpaused does nothing.
    music.pause();
    if (splashAt !== undefined && performance.now() - splashHeardAt < 2000) {
      music.currentTime = splashAt + (performance.now() - splashHeardAt) / 1000;
    }
    music.play().catch(() => {
      // Refused until the player interacts (or the file failed) — the
      // next tap/key retries.
      if (id === attempt) music.pause();
    });
  };

  const sync = (): void => {
    game.sound.mute = muted;
    button.classList.toggle('muted', muted);
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    button.setAttribute('aria-pressed', String(!muted));
    if (muted || document.hidden) {
      attempt++;
      music.pause();
      channel.post({ type: 'stop' });
    } else {
      start();
    }
  };

  // Every tap/key retries until the music is really playing. Touch
  // browsers only grant audio permission on the tap's release
  // (pointerup/touchend), not on pointerdown — listen for all of them.
  const unlockEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const unlock = (event: Event): void => {
    // The toggle runs its own sync() after flipping mute; starting the
    // music here first would make a first-tap mute blip the track.
    if (event.target instanceof Node && button.contains(event.target)) return;
    if (!playing) sync();
  };

  button.addEventListener('click', (event) => {
    // Don't let the toggle also count as a jump / canvas tap.
    event.stopPropagation();
    muted = !muted;
    writeMuted(muted);
    sync();
  });
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  for (const type of unlockEvents) {
    window.addEventListener(type, unlock, { capture: true });
  }
  // Leaving the app (tab switch, Reddit backgrounded) pauses the music;
  // coming back resumes it unless muted.
  document.addEventListener('visibilitychange', sync);
  // Closing the expanded view must silence the splash's copy too.
  window.addEventListener('pagehide', () => channel.post({ type: 'stop' }));
  // Phaser's sound manager finishes booting after this runs; re-apply the
  // saved mute once it's ready so a muted player's SFX stay muted too.
  game.events.once('ready', sync);
  // Try as soon as the assets are in: when the Play tap that opened this
  // view still counts as permission, the music starts on the menu. If the
  // browser blocks it, the first tap/key anywhere starts it instead.
  releaseMusic = () => {
    allowed = true;
    music.preload = 'auto';
    sync();
  };
  sync();
}
