// The splash → game music hand-off. Browsers only let a document start
// audio after a tap *in that document*, and the feed card's PLAY tap lands
// in the splash's frame — game.html opens as a fresh document that hasn't
// been tapped, so its own play() is refused until the first in-game tap.
// The splash therefore starts the track inside its click handler and keeps
// it going until the game's copy is really playing (picked up at the same
// position), or the game is muted/closed. Both frames are the same origin,
// so a BroadcastChannel connects them. Where the splash frame is torn down
// on expand, its copy just stops and the game's first tap starts the music.

export const MUSIC_URL = '/assets/music/evening-mood.m4a';
export const MUSIC_VOLUME = 0.35;
export const MUTED_KEY = 'sketchy:sound-muted';

const CHANNEL = 'sketchy:music';

// 'time': the splash's copy is playing at `at` seconds (sent ~4×/s).
// 'stop': the game has the music (or muted / closed) — the splash stops.
export type MusicMessage = { type: 'time'; at: number } | { type: 'stop' };

function isMusicMessage(value: unknown): value is MusicMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'stop') return true;
  return value.type === 'time' && 'at' in value && typeof value.at === 'number';
}

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export type MusicChannel = {
  post: (message: MusicMessage) => void;
};

export function openMusicChannel(onMessage: (message: MusicMessage) => void): MusicChannel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {} };
  const channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', (event) => {
    if (isMusicMessage(event.data)) onMessage(event.data);
  });
  return { post: (message) => channel.postMessage(message) };
}

// Called synchronously from a splash button's click handler, where the
// browser still allows audio.
export function startSplashMusic(): void {
  if (readMuted()) return;
  const music = new Audio(MUSIC_URL);
  music.loop = true;
  music.volume = MUSIC_VOLUME;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    music.pause();
    music.removeAttribute('src');
    music.load();
  };
  const channel = openMusicChannel((message) => {
    if (message.type === 'stop') stop();
  });
  music.addEventListener('timeupdate', () => {
    if (!stopped && !music.paused) channel.post({ type: 'time', at: music.currentTime });
  });
  music.play().catch(stop);
  // Back in the feed (expanded view closed) — never keep playing there.
  window.addEventListener('focus', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
}
