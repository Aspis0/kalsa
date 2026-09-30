// The first walk: Start → check → pick one → confirm the download → the
// live progress of measuring, downloading and tuning.

export const SETUP = {
  start: "Start",
  starting: "Starting…",
  checkingComputer: "Checking your computer…",
  gettingReady: "Getting ready…",
  downloading: "Downloading…",
  tuning: "Finding the best settings for your computer…",
  suggests: "Kalsa checks your computer and suggests a model.",
  pickModel: "Pick a model",
  smarter: "Smarter answers.",
  faster: "Faster answers.",
  useThis: "Use this",
  alreadyOnComputer: "Already on your computer",
  downloadSize: (gigabytes: string) => `${gigabytes} download`,
  downloadQ: (gigabytes: string) => `Download ${gigabytes}?`,
  needsFiles: (name: string) => `Kalsa needs these files to run ${name}.`,
  needsFile: (name: string) => `Kalsa needs this file to run ${name}.`,
  download: "Download",
  cancel: "Cancel",
  notSetUp: "The model was not set up.",
  tryAgain: "Try again",
  showDetails: "Show details",
  // The byte lines under a downloading phase.
  ofTotal: (done: string, total: string, unit: string) => `${done} of ${total} ${unit}`,
  sizeNotAnnounced: "Receiving — the size was not announced.",
  receivedSoFar: (received: string) => `${received} received so far.`,
  receiving: "Receiving.",
  pickingUp: (text: string) => `Picking up where it stopped — ${text}`,
};
