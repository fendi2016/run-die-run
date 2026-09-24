import { requestExpandedMode } from '@devvit/web/client';
import {
  DEFAULT_LEVEL_ID,
  SEED_AUTHOR,
  SPLASH_AUTOSTART_KEY,
  type SplashAutostart,
} from '../shared/constants';
import { isLevelStats } from '../shared/discoveryApi';
import { isCursedPostData } from '../shared/postData';
import { currentPostData } from './devvitContext';
import { requireButton, requireElement } from './ui/domUtils';
import { initFollowButton } from './ui/followButton';
import { clearRateText, versionText } from './ui/levelStatsText';

const playButton = document.getElementById('play-button') as HTMLButtonElement;
const buildButton = document.getElementById(
  'build-button'
) as HTMLButtonElement;
const browseButton = document.getElementById(
  'browse-button'
) as HTMLButtonElement;
const statValue = document.getElementById('stat-value') as HTMLSpanElement;
const creatorName = document.getElementById('creator-name') as HTMLSpanElement;

initFollowButton(requireButton('follow-button'));

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
    // expanded menu still provides all three destinations.
  }
  requestExpandedMode(event, 'game');
}

playButton.addEventListener('click', (e) => expandInto(e, 'game'));
buildButton.addEventListener('click', (e) => expandInto(e, 'editor'));
browseButton.addEventListener('click', (e) => expandInto(e, 'browse'));

// The level this post plays (its postData; a hub post has none and plays
// the default level). Fetched after the interactive content is already up,
// so a slow/failed request never blocks PLAY.
const rawPostData = currentPostData();
const postData = isCursedPostData(rawPostData) ? rawPostData : undefined;
const levelId = postData?.levelId ?? DEFAULT_LEVEL_ID;

if (postData?.daily !== undefined) {
  const daily = requireElement('level-daily');
  daily.textContent = `Day #${postData.daily}`;
  daily.classList.remove('hidden');
}

async function loadStats(): Promise<void> {
  try {
    const response = await fetch(
      `/api/discovery/stats/${encodeURIComponent(levelId)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const body: unknown = await response.json();
    if (!response.ok || !isLevelStats(body)) {
      return;
    }

    statValue.textContent = body.attempts.toLocaleString();
    creatorName.textContent =
      body.creatorUsername === SEED_AUTHOR ? 'CURSED' : `u/${body.creatorUsername}`;
    requireElement('level-title').textContent = body.title;
    requireElement('level-difficulty').textContent = body.difficulty;
    requireElement('level-version').textContent = versionText(body);
    requireElement('level-clear-rate').textContent = clearRateText(body);
    // Only a level post names its level; the hub post keeps a clean card.
    if (postData) requireElement('level-card').classList.remove('hidden');
  } catch {
    // Leave the placeholder dashes — PLAY already works either way.
  }
}

void loadStats();
