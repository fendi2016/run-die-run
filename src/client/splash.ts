import { requestExpandedMode } from '@devvit/web/client';
import {
  HUB_LEVEL_ID,
  SEED_AUTHOR,
  SPLASH_AUTOSTART_KEY,
  type SplashAutostart,
} from '../shared/constants';
import { isLevelStats } from '../shared/discoveryApi';
import { isSketchyPostData } from '../shared/postData';
import { currentPostData } from './devvitContext';
import { requireButton, requireElement } from './ui/domUtils';
import { initFollowButton } from './ui/followButton';
import { startSplashMusic } from './ui/musicHandoff';
import { showKillCount } from './ui/killLine';
import { startMenuGag } from './ui/menuGag';
import { deviceKind, sendAnalyticsEvent } from './analytics';

// The feed card is the game's main menu (same markup ids and menu.css as
// game.html's #game-menu); every button expands into the game.

initFollowButton(requireButton('game-menu-follow-btn'));
startMenuGag();

// `requestExpandedMode` only takes a devvit.json entrypoint name, not a
// route — there's no way to tell it "land on GameScene" directly. Instead,
// stash the intent in localStorage (same origin as game.html) right before
// expanding; MainMenu.create() reads and clears it, and jumps straight past
// itself to the matching scene instead of always landing on the menu.
function expandInto(event: MouseEvent, target: SplashAutostart): void {
  try {
    localStorage.setItem(SPLASH_AUTOSTART_KEY, target);
  } catch {
    // Storage can be unavailable in an embedded/private browser. The
    // expanded menu still provides every destination.
  }
  // Only this click may start audio — game.html opens as a document that
  // hasn't been tapped yet (see musicHandoff.ts).
  startSplashMusic();
  requestExpandedMode(event, 'game');
}

const targets: [string, SplashAutostart][] = [
  ['game-menu-play', 'game'],
  ['splash-build', 'editor'],
];
for (const [id, target] of targets) {
  requireButton(id).addEventListener('click', (e) => expandInto(e, target));
}

// The level this post plays (its postData; a hub post has none and plays
// today's Level of the Day). Fetched after the interactive content is
// already up, so a slow/failed request never blocks PLAY.
const rawPostData = currentPostData();
const postData = isSketchyPostData(rawPostData) ? rawPostData : undefined;
const levelId = postData?.levelId ?? HUB_LEVEL_ID;

async function loadStats(): Promise<void> {
  try {
    const response = await fetch(`/api/discovery/stats/${encodeURIComponent(levelId)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body: unknown = await response.json();
    if (!response.ok || !isLevelStats(body)) {
      return;
    }

    requireElement('splash-plays-value').textContent = body.attempts.toLocaleString();
    showKillCount(body);
    requireElement('game-menu-creator-name').textContent =
      body.creatorUsername === SEED_AUTHOR ? 'SKETCHY' : `u/${body.creatorUsername}`;
    const avatar = document.getElementById('splash-creator-avatar');
    if (body.creatorAvatarUrl && avatar instanceof HTMLImageElement) {
      // Shown only once it loads, so a blocked or broken image leaves no gap.
      avatar.addEventListener('load', () => avatar.classList.remove('hidden'), { once: true });
      avatar.src = body.creatorAvatarUrl;
    }
    // Only a level post names its level; the hub post keeps a clean header.
    if (postData) {
      requireElement('splash-level-title').textContent = body.title;
      requireElement('splash-level').classList.remove('hidden');
    }
  } catch {
    // Leave the placeholder dashes — PLAY already works either way.
  }
}

// The game's code is most of what Play waits on. Fetching it while the
// pointer is over the card (or as a tap begins) puts it in the browser
// cache, so the game opens from cache. Feed scrollers who never come near
// the card download nothing. Paths match the build output (checked by
// tools/check-client-build.mjs).
let gamePrefetched = false;
function prefetchGame(): void {
  if (gamePrefetched) return;
  gamePrefetched = true;
  for (const path of ['/game.js', '/game.css']) {
    void fetch(path).catch(() => undefined);
  }
}
document.addEventListener('pointerover', prefetchGame, { once: true });
document.addEventListener('pointerdown', prefetchGame, { once: true });

void loadStats();
sendAnalyticsEvent({ event: 'card', device: deviceKind() });
