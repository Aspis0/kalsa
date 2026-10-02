// The first walk: Start → check → pick one → confirm the download → the
// live progress of measuring, downloading and tuning.

export const SETUP = {
  start: "Start",
  starting: "Starting…",
  checkingComputer: "Checking your computer…",
  gettingReady: "Getting ready…",
  downloading: "Downloading…",
  tuning: "Finding what runs fastest on your computer…",
  suggests: "Kalsa checks your computer and picks the AI that runs best on it.",
  pickModel: "Pick the AI",
  smarter: "Smarter answers.",
  faster: "Faster answers.",
  useThis: "Use this",
  alreadyOnComputer: "Already on your computer",
  downloadSize: (gigabytes: string) => `${gigabytes} download`,
  downloadQ: (gigabytes: string) => `Download ${gigabytes}?`,
  needsFiles: (name: string) => `Kalsa needs these files to answer with ${name}.`,
  needsFile: (name: string) => `Kalsa needs this file to answer with ${name}.`,
  download: "Download",
  cancel: "Cancel",
  notSetUp: "Kalsa couldn't get ready. Try again.",
  tryAgain: "Try again",
  showDetails: "Show details",
  checkingModel: "Checking the AI already on your computer…",
  // The byte lines under a downloading phase.
  ofTotal: (done: string, total: string, unit: string) => `${done} of ${total} ${unit}`,
  sizeNotAnnounced: "Downloading. The total size isn't known yet.",
  receivedSoFar: (received: string) => `${received} received so far.`,
  receiving: "Receiving.",
  pickingUp: (text: string) => `Picking up where it stopped — ${text}`,
  // The tune's own line, under the bar: which test it is, how long it has
  // run, and — once one finished — what is left of the wait.
  attempt: (index: number, total: number) => `Test ${index} of ${total}`,
  minutesLeft: (minutes: number) => `about ${minutes} min left`,
  // A stop, not a finish: the budget ran out with the plan unfinished.
  finishNextStart: "Kalsa will finish testing next time it starts",
  almostDone: "almost done",
};
