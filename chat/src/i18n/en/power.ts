// The on/off state as words, shared by the home page and the Power page:
// one decision, so the two pages can never disagree about the same machine.

export const POWER = {
  notKnown: "Kalsa's state is unknown",
  couldNotTell: "Kalsa's state couldn't be read. Try again.",
  tryAgain: "Try again",
  stopping: "Kalsa is turning off…",
  puttingAway: "Kalsa is turning off. Next time it starts with your choice.",
  nextTimeChoice: "Next time it starts with your choice.",
  starting: "Kalsa is starting…",
  gettingReady: "Getting ready. On a slower computer this can take a minute.",
  didNotStart: "Kalsa couldn't start",
  off: "Kalsa is off",
  notRunningAnything: "Press the button to wake it up.",
  turnOn: "Turn on",
  onAsleep: "Kalsa is resting",
  on: "Kalsa is on",
  readyForYou: "Ready to chat.",
  asleepSentence: "Kalsa is resting to free up memory. Your next message wakes it up in a few seconds.",
  phoneInUse: "Your phone is using this computer right now.",
  turnOff: "Turn off",
  stopped: "Kalsa stopped",
  stopFailed: "Kalsa didn't turn off",
  stopFailure: "Close this window to stop it.",
  throttled: "This computer is running slower on purpose, to protect itself. Answers take longer than usual.",
  // The hint under Home's round button: what pressing it does.
  pressToTurnOn: "Press to turn on",
  pressToTurnOff: "Press to turn off",
  pressToTryAgain: "Press to try again",
};
