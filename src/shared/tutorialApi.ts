// Wire contract for GET /api/tutorial — whether the signed-in player has
// already been through the first-play tutorial. POST /api/tutorial/done
// records it.
export type TutorialStatusResponse = {
  done: boolean;
};

export function isTutorialStatusResponse(value: unknown): value is TutorialStatusResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'done' in value &&
    typeof value.done === 'boolean'
  );
}
