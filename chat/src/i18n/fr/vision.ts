// English for now: the vision offer ships before its translation. The keys
// are the same as `en/vision.ts`, and tsc enforces that.

const offerName = "Let Kalsa see images";

export const VISION = {
  offerName,
  offer: (size: string) => `${offerName} (downloads ${size})`,
  downloadQ: (size: string) =>
    `Download ${size} so Kalsa can see images? Kalsa restarts when it's done.`,
  download: "Download",
  notNow: "Not now",
  restarting: "Restarting Kalsa…",
  tryAgain: "Try again",
  doesNotFit: "This computer doesn't have room in memory for image support with this AI.",
};
