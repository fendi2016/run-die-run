// Wire contract for POST /api/follow — subscribes the current user to the
// subreddit this app is running in (reddit.subscribeToCurrentSubreddit()).
export type FollowSubredditResponse = {
  subscribed: true;
  subredditName: string;
};

export function isFollowSubredditResponse(
  value: unknown
): value is FollowSubredditResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'subscribed' in value &&
    value.subscribed === true &&
    'subredditName' in value &&
    typeof value.subredditName === 'string'
  );
}
