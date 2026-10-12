// The first walk: Start → check → pick one → confirm the download → the
// live progress of measuring, downloading and tuning.

export const SETUP = {
  start: "Start",
  starting: "Starting…",
  checkingComputer: "Checking your computer…",
  gettingReady: "Getting ready…",
  downloading: "Downloading…",
  downloadingAi: "Downloading Kalsa's AI…",
  tuning: "Finding the fastest settings for this computer…",
  pickModel: "Choose one.",
  alreadyOnComputer: "Already on your computer",
  downloadQ: (gigabytes: string) => `Download ${gigabytes}?`,
  needsFiles: (name: string) => `Kalsa needs these files to answer with ${name}.`,
  needsFile: (name: string) => `Kalsa needs this file to answer with ${name}.`,
  download: "Download",
  cancel: "Cancel",
  tryAgain: "Try again",
  checkingModel: "Checking the AI already on your computer…",
  // The byte lines under a downloading phase.
  ofTotal: (done: string, total: string, unit: string) => `${done} of ${total} ${unit}`,
  sizeNotAnnounced: "Downloading. The total size isn't known yet.",
  receivedSoFar: (received: string) => `${received} received so far.`,
  receiving: "Receiving.",
  pickingUp: (text: string) => `Resuming: ${text}`,
  // The tune's own line, under the bar: which test it is and what is left
  // of the wait — the budget's own ceiling until two tests have finished,
  // the average's estimate from then on.
  attempt: (index: number, total: number) => `Test ${index} of ${total}`,
  minutesLeft: (minutes: number) => `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`,
  // The once-only note under the tune's line: one run, and the window
  // can go away while it happens.
  tuneOnce: "This happens only once. You can minimize Kalsa and keep using your computer.",
  // A stop, not a finish: the budget ran out with the plan unfinished.
  finishNextStart: "Kalsa will finish testing next time it starts.",
  // The second stop: this start was the retry, its verdict is saved as a
  // record — nothing further will be measured.
  keptBest: "Kalsa kept the best settings it found.",
  // …and when there was nothing to keep: the rule stands.
  standardSettings: "Kalsa will use its standard settings.",
  almostDone: "Almost done.",
  welcome: "Welcome to Kalsa",
  welcomeLine: "A private assistant that runs on this computer. Your messages and answers stay on it.",
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  pickLine: "Both work well on this computer. You can change this later.",
  continue: "Continue",
  recommended: "Recommended",
  couldNotGetReady: "Kalsa couldn't get ready.",
  tooWeak: "Kalsa can't run well on this computer yet",
  tooWeakNote: "Kalsa will not start on a computer where it would be too slow.",
  withMinutesLeft: (text: string, minutes: number) => `${text} · about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`,
  withLongWait: (text: string) => `${text} · this may take a while`,
  showDetails: "Show details",
  once: "This happens only once.",
  ready: "Kalsa is ready",
  readyLine: "Everything is set up.",
};
