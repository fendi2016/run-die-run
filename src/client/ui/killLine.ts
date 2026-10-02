import type { LevelStats } from '../../shared/discoveryApi';
import { requireElement } from './domUtils';

// "☠ 476 kills" beside the play/run count (#menu-kills, on the feed card and in
// game.html's menu): every kill this level's traps have scored. Hidden
// until there's one.
export function showKillCount(stats: LevelStats): void {
  const kills = stats.trapKills ?? 0;
  requireElement('menu-kills-value').textContent = kills.toLocaleString();
  requireElement('menu-kills').classList.toggle('hidden', kills === 0);
}
