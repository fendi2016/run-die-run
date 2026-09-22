// `AbortSignal.any` isn't available on WebKit older than 17.4 (iOS 17.4,
// March 2024) or on older Android System WebView builds — a Devvit web app
// is embedded in whatever webview the visiting device's Reddit app ships,
// so this can't assume a recent one. Composing the timeout and caller signal
// by hand instead keeps every fetch's abort behavior working on any device
// this app actually runs on, unlike `AbortSignal.any([signal,
// AbortSignal.timeout(ms)])`, which throws synchronously (and silently fails
// the fetch it guards, before the network call even starts) wherever
// `.any` is missing.
export function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const forward = (source: AbortSignal): void => {
    if (source.aborted) {
      controller.abort(source.reason);
      return;
    }
    source.addEventListener('abort', () => controller.abort(source.reason), {
      once: true,
    });
  };
  forward(signal);
  forward(AbortSignal.timeout(timeoutMs));
  return controller.signal;
}
