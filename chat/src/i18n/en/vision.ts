// The vision offer: the projector Kalsa can download so this model can see
// images, and the three faces of that download.

const offerName = "Let Kalsa see pictures";

export const VISION = {
  /** The button's name alone, for places that name it without its size. */
  offerName,
  /** The quiet affordance beside the attach button. `size` is the download's
      own figure, in the unit `lib/downloadBytes.ts` chooses. */
  offer: (size: string) => `${offerName} · ${size}`,
  /** The ask, once: what it costs and that the engine restarts behind it. */
  downloadQ: (size: string) =>
    `Download ${size} so Kalsa can see pictures? Kalsa restarts when the download is done.`,
  download: "Download",
  notNow: "Not now",
  /** After the bytes, while the engine comes back. */
  restarting: "Restarting Kalsa…",
  tryAgain: "Try again",
  /** The memory plan's refusal: no room for the projector beside the model. */
  doesNotFit: "This computer doesn't have enough memory for this AI to see pictures.",
};
