import { requireElement } from './domUtils';

const DISPLAY_MS = 4000;
const GAP_MS = 250;

// DOM toast for Realtime events (spec section 29). GameScene only ever
// enqueues from its own shutdown (never mid-run, so a run in progress is
// never interrupted) with at most two messages — a version publish and a
// world record — so a small queue is enough to show them one after another
// instead of one clobbering the other.
export class RealtimeToast {
  private static singleton: RealtimeToast | undefined;

  static instance(): RealtimeToast {
    return (RealtimeToast.singleton ??= new RealtimeToast());
  }

  private readonly root = requireElement('realtime-toast');
  private readonly messageEl = requireElement('realtime-toast-message');
  private queue: string[] = [];
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor() {}

  enqueue(message: string): void {
    this.queue.push(message);
    if (!this.hideTimer) {
      this.showNext();
    }
  }

  private showNext(): void {
    const message = this.queue.shift();
    if (!message) {
      return;
    }
    this.messageEl.textContent = message;
    this.root.classList.remove('hidden');
    this.hideTimer = setTimeout(() => {
      this.root.classList.add('hidden');
      this.hideTimer = undefined;
      setTimeout(() => this.showNext(), GAP_MS);
    }, DISPLAY_MS);
  }
}
