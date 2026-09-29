// What a SKETCHY custom post carries in its Devvit `postData` (≤2KB,
// readable as `context.postData` on both client and server). A post with
// no postData is a hub post and plays DEFAULT_LEVEL_ID. `daily` is the
// Level of the Day number when the post was made by the daily scheduler.
export type SketchyPostData = {
  levelId: string;
  daily?: number;
};

export function isSketchyPostData(value: unknown): value is SketchyPostData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'levelId' in value &&
    typeof value.levelId === 'string' &&
    value.levelId.length > 0 &&
    (!('daily' in value) ||
      (typeof value.daily === 'number' && Number.isSafeInteger(value.daily)))
  );
}

export function levelIdFromPostData(value: unknown): string | undefined {
  return isSketchyPostData(value) ? value.levelId : undefined;
}
