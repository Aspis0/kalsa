// The tester's report: the Advanced section, the crash prompt and the
// webview error screen share these words. The privacy sentence is the one
// the owner wanted in big letters wherever a Send button appears.

export const REPORT = {
  title: "Report a problem",
  privacy: "The log never contains your messages, Kalsa's answers, your files, or any code or key.",
  facts:
    "It holds what Kalsa did and what this computer has: versions, processor, graphics card, memory, errors.",
  send: "Send the log",
  open: "Open the log folder",
  openFailed: "Kalsa couldn't open the log folder.",
  sending: "Sending…",
  sentWithId: (id: string) => `Sent. Your report number is ${id} — tell us this number.`,
  errRateLimited: "Wait a minute and try again.",
  errTryTomorrow: "We received too many reports today. Try again tomorrow.",
  errSend: "Could not send. Check the internet connection and try again.",
  crashTitle: "Something went wrong",
  crashUncleanTitle: "Kalsa did not close normally last time",
  crashUncleanBody: "If something went wrong, sending the log helps us fix it.",
  notNow: "Not now",
};
