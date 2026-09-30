// What Kalsa did before she answered: the quiet line per check, the ask
// before a web call leaves an app with documents attached, what the detector
// saw, and the refusals a tool round can end in.

export const TOOLS = {
  checking: "Kalsa is checking something…",
  pageNotOpened: "Kalsa couldn't open that page. Try again.",
  searchDidNotRun: "Kalsa couldn't search the web. Try again.",
  couldNotFinish: "Kalsa couldn't finish checking. Ask again.",
  read: (what: string) => `Kalsa read ${what}`,
  aPage: "a page",
  searchedFor: (query: string) => `Searched for “${query}”`,
  searchedWeb: "Kalsa searched the web",
  searchedForLabel: "Searched for:",
  askedForLabel: "Asked for:",
  // The gate's ask.
  searchWaitingTitle: "Kalsa wants to search the web. Allow it?",
  pageWaitingTitle: "Kalsa wants to open a web page. Allow it?",
  gateWhy: (docs: string) => `${docs}, so Kalsa shows you what she would send online before sending it.`,
  oneDocument: "One document is attached",
  documentsAttached: (count: number) => `${count} documents are attached`,
  exactTextSearch: "Kalsa would search the web for:",
  exactTextPage: "Kalsa would open this address:",
  findingFrom: (source: string) => ` from ${source}`,
  nothingRecognisable: "Nothing recognisable was found in it.",
  oneMoreWaiting: "Kalsa has 1 more to check after this one.",
  moreWaiting: (count: number) => `Kalsa has ${count} more to check after this one.`,
  sendIt: "Send it",
  refuse: "Refuse",
  // What the detector saw, by the kind it reports.
  findings: {
    copiedText: "copied text",
    npmToken: "a sign-in code",
    privateKey: "a private key",
    card: "payment card number",
    email: "email address",
    phone: "phone number",
    hexSecret: "a possible password or code",
    secret: "a possible password or code",
  } as Record<string, string>,
  // The refusals a tool round can end in. They are both shown and sent back
  // as the call's answer, so the model reads them in the owner's language.
  noRoundLeft: "Kalsa couldn't finish checking. Ask again.",
  turnEnded: "Kalsa couldn't finish checking. Ask again.",
  nameNeverArrived: "Kalsa couldn't finish checking. Ask again.",
  stopped: "You stopped this before Kalsa finished.",
  argumentsTooLong: "That was too long for Kalsa to check. Try a shorter search or address.",
  argumentsNotValid: "Kalsa couldn't finish checking. Ask again.",
};
