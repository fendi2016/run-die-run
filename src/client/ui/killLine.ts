import { requireElement } from './domUtils';

// The menu's deadliest-trap line (#game-menu-kills), shared by the feed
// card and game.html's menu. Hidden while there's nothing to show.
export function showKillLine(text: string): void {
  requireElement('game-menu-kills-text').textContent = text;
  requireElement('game-menu-kills').classList.toggle('hidden', text === '');
}
