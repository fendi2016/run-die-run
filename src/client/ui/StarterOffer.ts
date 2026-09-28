import { requireButton, requireElement } from './domUtils';

// How long the offer stays up before quietly going away.
const OFFER_MS = 8000;

// "Too tough? Warm up on an easy course →": offered to a player who keeps
// dying early on a community level. Only the button takes taps, so the
// rest of the screen still jumps. Singleton like PreviewBackButton: the
// DOM outlives any one GameScene.
export class StarterOffer {
  private static singleton: StarterOffer | undefined;

  static instance(): StarterOffer {
    return (StarterOffer.singleton ??= new StarterOffer());
  }

  private readonly root = requireElement('starter-offer');
  private readonly button = requireButton('starter-offer-btn');
  private hideTimer: number | undefined;

  private constructor() {}

  show(onAccept: () => void): void {
    this.button.onclick = () => {
      this.hide();
      onAccept();
    };
    this.root.classList.remove('hidden');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), OFFER_MS);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.button.onclick = null;
    this.root.classList.add('hidden');
  }
}
