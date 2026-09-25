import type * as Phaser from 'phaser';
import { requireButton } from './domUtils';

// Background music ("Evening Mood") plus the one global mute that also
// silences Phaser's SFX. The music is a plain <audio> element rather than
// a Phaser-loaded sound: it streams instead of blocking the Preloader on a
// 2 MB download, and isn't decoded into ~30 MB of PCM in memory. AAC
// (.m4a), not the delivered .ogg — Ogg Vorbis isn't reliably playable in
// iOS webviews, and the Reddit app is one.
const MUSIC_URL = '/assets/music/evening-mood.m4a';
const MUSIC_VOLUME = 0.35;
const MUTED_KEY = 'cursed:sound-muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
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
  // Start downloading right away so the music is buffered by the time
  // the player taps — with 'none' the fetch only began on that first tap
  // and the run opened on a couple of seconds of silence.
  music.preload = 'auto';
  let muted = readMuted();
  // Only real playback counts: the track time has to actually advance.
  // Some webviews report a blocked play() as started (paused=false, even
  // a 'playing' event) while staying silent, and trusting that is what
  // left the music off for good before.
  let playing = false;
  let lastTime = 0;
  music.addEventListener('timeupdate', () => {
    if (!music.paused && music.currentTime !== lastTime) playing = true;
    lastTime = music.currentTime;
  });
  music.addEventListener('pause', () => {
    playing = false;
  });
  // Bumped on every start attempt so a stale attempt's rejection can't
  // pause a newer one that's already underway.
  let attempt = 0;

  const start = (): void => {
    if (playing) return;
    const id = ++attempt;
    // Reset a fake start first — play() on a track that claims to be
    // unpaused does nothing.
    music.pause();
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
  // Phaser's sound manager finishes booting after this runs; re-apply the
  // saved mute once it's ready so a muted player's SFX stay muted too.
  game.events.once('ready', sync);
  // Try right away: when the Play tap that opened this view still counts
  // as permission, the music starts with the game. If the browser blocks
  // it, the first tap/key anywhere starts it instead.
  sync();
}
