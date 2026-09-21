import { requestExpandedMode } from '@devvit/web/client';
import {
  DEFAULT_LEVEL_ID,
  SPLASH_AUTOSTART_KEY,
  type SplashAutostart,
} from '../shared/constants';
import { isDiscoveryResponse } from '../shared/discoveryApi';

const playButton = document.getElementById('play-button') as HTMLButtonElement;
const buildButton = document.getElementById(
  'build-button'
) as HTMLButtonElement;
const browseButton = document.getElementById(
  'browse-button'
) as HTMLButtonElement;
const statValue = document.getElementById('stat-value') as HTMLSpanElement;
const creatorName = document.getElementById(
  'creator-name'
) as HTMLSpanElement;

// `requestExpandedMode` only takes a devvit.json entrypoint name, not a
// route — there's no way to tell it "land on GameScene" directly. Instead,
// stash the intent in localStorage (same origin as game.html) right before
// expanding; MainMenu.create() reads and clears it, and jumps straight past
// itself to the matching scene instead of always landing on the menu.
function expandInto(event: MouseEvent, target: SplashAutostart): void {
  localStorage.setItem(SPLASH_AUTOSTART_KEY, target);
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
    const response = await fetch('/api/discovery/levels?sort=new');
    const body: unknown = await response.json();
    if (!response.ok || !isDiscoveryResponse(body)) {
      return;
    }
    const level = body.levels.find((l) => l.levelId === DEFAULT_LEVEL_ID);
    if (!level) {
      return;
    }
    statValue.textContent = level.attempts.toLocaleString();
    creatorName.textContent = `u/${level.creatorUsername}`;
  } catch {
    // Leave the placeholder dashes — PLAY already works either way.
  }
}

void loadStats();
