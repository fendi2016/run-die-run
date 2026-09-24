import { context } from '@devvit/web/client';
import { DEFAULT_LEVEL_ID } from '../../shared/constants';
import { levelIdFromPostData } from '../../shared/postData';

// Which level this post plays: `?level=<id>` (manual testing) wins, then
// the level the post was created for (its Devvit postData — one post per
// published level, plus the daily feature), then the default level for a
// hub post that carries no postData.
export function getRequestedLevelId(): string {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('level') ||
    levelIdFromPostData(context.postData) ||
    DEFAULT_LEVEL_ID
  );
}
