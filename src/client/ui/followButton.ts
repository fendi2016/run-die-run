import { showToast } from '@devvit/web/client';
import { isFollowSubredditResponse } from '../../shared/followApi';

// Wires a Follow button to POST /api/follow. Shared between splash.html's
// card and game.html's #game-menu — the only two places Follow lives now,
// so following isn't gated behind hitting a trap first. Label stays the
// short generic "Follow" rather than "Follow r/<subreddit>" — these are
// compact header buttons, not the old death-panel's full-width one, and a
// long subreddit name would overflow the header on mobile; the confirming
// toast names the subreddit instead. Each menu gets its own button
// element/instance; there's no cross-menu "already followed" state to
// sync, since only one of the two menus is ever visible at a time.
export function initFollowButton(button: HTMLButtonElement): void {
  button.addEventListener('click', () => {
    button.disabled = true;
    fetch('/api/follow', { method: 'POST' })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((json: unknown) => {
        if (isFollowSubredditResponse(json)) {
          button.textContent = 'Following ✓';
          showToast(`Followed r/${json.subredditName}!`);
        } else {
          button.disabled = false;
          showToast('Could not follow — try again.');
        }
      })
      .catch(() => {
        button.disabled = false;
        showToast('Could not follow — try again.');
      });
  });
}
