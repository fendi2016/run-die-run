import { requestExpandedMode } from '@devvit/web/client';
import {
  DEFAULT_LEVEL_ID,
  SPLASH_AUTOSTART_KEY,
  type SplashAutostart,
} from '../shared/constants';
import { isLevelStats } from '../shared/discoveryApi';
import { requireButton } from './ui/domUtils';
import { initFollowButton } from './ui/followButton';

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

// Real stats for the one level this build actually points new players at
// (there's no per-post level binding yet — every post shares
// DEFAULT_LEVEL_ID) rather than a made-up number. Fetched after the
// interactive content is already up, so a slow/failed request never blocks
// PLAY.
async function loadStats(): Promise<void> {
  try {
    const response = await fetch(
      `/api/discovery/stats/${encodeURIComponent(DEFAULT_LEVEL_ID)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const body: unknown = await response.json();
    if (!response.ok || !isLevelStats(body)) {
      return;
    }

    statValue.textContent = body.attempts.toLocaleString();
    creatorName.textContent = `u/${body.creatorUsername}`;
  } catch {
    // Leave the placeholder dashes — PLAY already works either way.
  }
}

void loadStats();
