// The on/off state as words, shared by the home page and the Server page:
// one decision, so the two pages can never disagree about the same machine.

export const POWER = {
  notKnown: "Not known",
  couldNotTell: "This page could not tell whether the assistant is running. Trying again usually works.",
  tryAgain: "Try again",
  stopping: "Stopping",
  puttingAway: "Putting the assistant away.",
  starting: "Starting",
  gettingReady: "Getting ready. On an older computer this can take a minute.",
  didNotStart: "Did not start",
  off: "Off",
  notRunningAnything: "This computer is not running anything right now.",
  turnOn: "Turn on",
  onAsleep: "On, asleep",
  on: "On",
  readyForYou: "This computer is ready for you.",
  asleepSentence: "The model is not in memory right now. Your next message brings it back, which takes a few seconds.",
  phoneInUse: "Your phone is using this computer right now.",
  turnOff: "Turn off",
  stopped: "Stopped",
  stopFailure: "The assistant did not turn off. Closing this window will stop it.",
};
