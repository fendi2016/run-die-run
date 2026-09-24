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

  const sync = (): void => {
    game.sound.mute = muted;
    button.classList.toggle('muted', muted);
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    button.setAttribute('aria-pressed', String(!muted));
    if (muted || document.hidden) {
      music.pause();
    } else {
      music.play().catch(() => {
        // Autoplay refused until the player interacts (or the file
        // failed) — stays silent, the next tap/key retries.
      });
    }
  };

  // Try to play on load: when the Play tap that opened this view still
  // counts as user activation, the music starts with the game. Otherwise
  // the browser blocks it and the first tap/key anywhere starts it.
  const unlock = (): void => {
    if (!music.paused) return;
    sync();
  };
  music.addEventListener(
    'playing',
    () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    },
    { once: true },
  );

  button.addEventListener('click', (event) => {
    // Don't let the toggle also count as a jump / canvas tap.
    event.stopPropagation();
    muted = !muted;
    writeMuted(muted);
    sync();
  });
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  // Leaving the app (tab switch, Reddit backgrounded) pauses the music;
  // coming back resumes it unless muted.
  document.addEventListener('visibilitychange', sync);
  // Phaser's sound manager finishes booting after this runs; re-apply the
  // saved mute once it's ready so a muted player's SFX stay muted too.
  game.events.once('ready', sync);
  sync();
}
