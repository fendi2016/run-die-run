// A level title becomes the title of a real Reddit post (core/post.ts), so
// it can't carry links, user/subreddit pings, or markdown. Returns '' when
// nothing usable is left, which callers treat as "pick another title".
export function sanitizeLevelTitle(raw: string, maxLength: number): string {
  return raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\b([ur])\/(?=\w)/gi, '$1 ')
    .replace(/[[\]()*_~`#>|\\<]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}
