import { context, type Context } from '@devvit/web/client';

// `@devvit/web/client`'s `context` is really `globalThis.devvit?.context`:
// set inside Reddit's iframe, undefined anywhere else (the local Playwright
// harness, a plain browser tab). Its type doesn't admit that, so reading
// `context.postData` directly throws at module load outside Reddit. Read
// it through here instead.
const maybeContext: Context | undefined = context;

export function currentPostData(): unknown {
  return maybeContext?.postData;
}

export function currentSubredditName(): string | undefined {
  return maybeContext?.subredditName;
}
