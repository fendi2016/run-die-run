import { context, reddit } from '@devvit/web/server';
import { CURSE_COMMENT_EVERY } from '../../shared/constants';
import type { LevelStats } from '../../shared/discoveryApi';
import { clearRateText } from '../../shared/levelStatsText';
import { labelFor } from '../../shared/objectLabels';
import type { LevelObject, ObjectType } from '../../shared/types';
import { getLevelStats } from '../services/DiscoveryService';
import { getCurrentLevelVersion } from '../services/LevelService';
import { getLevelPostId } from './post';

// Every Nth curse (not every one — that flooded busy threads) becomes one
// comment on the level's thread summing up the last N: what went in, who
// put it there, and the clear rate now. Keeps the post bumping and names
// the cursers without a comment per curse.

// A curse's own object, plus any ground/finish its extension added — only
// the former is "what they cursed it with".
const EXTENSION_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>(['ground', 'finish']);
const NAMED_CURSERS = 3;

export function isCurseMilestone(version: number): boolean {
  const curses = version - 1;
  return curses > 0 && curses % CURSE_COMMENT_EVERY === 0;
}

export function curseMilestoneComment(opts: {
  title: string;
  version: number;
  objects: readonly LevelObject[];
  stats: LevelStats | undefined;
}): string {
  const curses = opts.version - 1;
  const firstVersion = opts.version - CURSE_COMMENT_EVERY + 1;
  const added = opts.objects.filter(
    (o) =>
      o.addedInVersion >= firstVersion &&
      o.addedInVersion <= opts.version &&
      !EXTENSION_TYPES.has(o.type)
  );

  const counts = new Map<string, number>();
  const cursers: string[] = [];
  for (const object of added) {
    const label = labelFor(object.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (!cursers.includes(object.addedBy)) cursers.push(object.addedBy);
  }
  const what = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => (n === 1 ? label : `${label} ×${n}`))
    .join(', ');
  const named = cursers.slice(0, NAMED_CURSERS).map((name) => `u/${name}`);
  const others = cursers.length - named.length;
  const who =
    others > 0
      ? `${named.join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`
      : named.join(' and ');

  const lines = [`🩸 **"${opts.title}" just took its ${curses}th curse.**`];
  if (what !== '') lines.push(`The last ${CURSE_COMMENT_EVERY}: ${what} — from ${who}.`);
  const rate = opts.stats ? ` Right now: ${clearRateText(opts.stats)}.` : '';
  lines.push(`Every one was beaten by the player who placed it.${rate} Can you still get through?`);
  return lines.join('\n\n');
}

// Best-effort side output of an already-committed curse: logs and returns
// on any failure, never throwing into the publish route.
export async function announceCurseMilestone(levelId: string, version: number): Promise<void> {
  if (!isCurseMilestone(version)) return;
  try {
    const postId = (await getLevelPostId(levelId)) ?? context.postId;
    if (!postId) return;
    const [stats, level] = await Promise.all([
      getLevelStats(levelId),
      getCurrentLevelVersion(levelId),
    ]);
    await reddit.submitComment({
      id: postId,
      text: curseMilestoneComment({
        title: stats?.title ?? levelId,
        version,
        objects: level?.objects ?? [],
        stats,
      }),
      runAs: 'APP',
    });
  } catch (error) {
    console.error(`Curse milestone comment failed for ${levelId} v${version}: ${error}`);
  }
}
