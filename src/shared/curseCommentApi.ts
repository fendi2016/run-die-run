// Wire contract for POST /api/curse/comment — after a player's trap goes
// live they're offered a ready-made comment on the level's post, posted
// from their own account only if they choose to. One per trap they've
// placed on the level.
export const CURSE_COMMENT_MAX_LENGTH = 500;

export const CURSE_COMMENT_SUGGESTIONS = [
  'No way you’re beating this now 😈',
  'Good luck with that. You’ll need it 😈',
  'I made this level worse. Can you still beat it? 😈',
] as const;

// POST /api/curse/comment-prompt: whether to offer the prompt now. Only
// the first call per player ever answers true (it marks it as offered).
export type CommentPromptResponse = { offer: boolean };

export function isCommentPromptResponse(value: unknown): value is CommentPromptResponse {
  return typeof value === 'object' && value !== null && 'offer' in value && typeof value.offer === 'boolean';
}

export type CurseCommentRequest = {
  levelId: string;
  text: string;
};

export type CurseCommentResponse =
  | { status: 'ok' }
  | { status: 'error'; message: string };

export function isCurseCommentRequest(value: unknown): value is CurseCommentRequest {
  return (
    typeof value === 'object' && value !== null &&
    'levelId' in value && typeof value.levelId === 'string' && value.levelId.length > 0 &&
    'text' in value && typeof value.text === 'string'
  );
}

export function isCurseCommentResponse(value: unknown): value is CurseCommentResponse {
  if (typeof value !== 'object' || value === null || !('status' in value)) return false;
  if (value.status === 'ok') return true;
  return value.status === 'error' && 'message' in value && typeof value.message === 'string';
}
