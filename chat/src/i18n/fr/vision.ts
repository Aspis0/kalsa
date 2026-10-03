// English for now: the vision offer ships before its translation. The keys
// are the same as `en/vision.ts`, and tsc enforces that.

export const VISION = {
  offer: (size: string) => `Let Kalsa see images (downloads ${size})`,
  downloadQ: (size: string) =>
    `Download ${size} so Kalsa can see images? Kalsa restarts when it's done.`,
  download: "Download",
  notNow: "Not now",
  restarting: "Restarting Kalsa…",
  tryAgain: "Try again",
  doesNotFit: "This computer doesn't have room in memory for image support with this AI.",
};
