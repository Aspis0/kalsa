// What the assistant did before it answered: the quiet line per call, the
// ask before a web call leaves an app with documents attached, what the
// detector saw, and the refusals a tool round can end in.

export const TOOLS = {
  openingPage: "Opening the page…",
  searchingWeb: "Searching the web…",
  unnamedRunning: "A tool call arrived unnamed…",
  running: (name: string) => `Running ${name}…`,
  unnamedFailed: "A tool call arrived unnamed",
  ranUnnamed: "Ran an unnamed tool",
  pageNotOpened: "That page could not be opened",
  read: (what: string) => `Read ${what}`,
  aPage: "a page",
  searchDidNotRun: "That search did not run",
  searchedFor: (query: string) => `Searched for “${query}”`,
  searchedWeb: "Searched the web",
  didNotRun: (name: string) => `${name} did not run`,
  ran: (name: string) => `Ran ${name}`,
    "searchedForLabel": "Searched for:",
    "askedForLabel": "Asked for:",
  // The gate's ask.
  searchWaitingTitle: "A search is waiting to leave the app.",
  pageWaitingTitle: "A page request is waiting to leave the app.",
  gateWhy: (docs: string) => `${docs} to this conversation, so every web call is shown here first, before anything is sent.`,
  oneDocument: "One document is attached",
  documentsAttached: (count: number) => `${count} documents are attached`,
  exactTextSearch: "The exact text that would be sent as the search:",
  exactTextPage: "The exact text that would be sent as the address:",
  findingFrom: (source: string) => ` from ${source}`,
  nothingRecognisable: "Nothing recognisable was found in it.",
  oneMoreWaiting: "Another call is waiting behind this one.",
  moreWaiting: (count: number) => `${count} more calls are waiting behind this one.`,
  sendIt: "Send it",
  refuse: "Refuse",
  // What the detector saw, by the kind it reports.
  findings: {
    copiedText: "copied text",
    npmToken: "npm access token",
    privateKey: "private key",
    card: "payment card number",
    email: "email address",
    phone: "phone number",
    hexSecret: "possible secret (hex)",
    secret: "possible secret",
  } as Record<string, string>,
  // The refusals a tool round can end in. They are both shown and sent back
  // as the call's answer, so the model reads them in the owner's language.
  noRoundLeft: "There was no round left to run this, so the answer had to be in words.",
  turnEnded: (reason: string) => `The server sent a tool call but ended the turn as “${reason}”, so nothing was run.`,
  nameNeverArrived: "The stream ended before this call's name arrived, so nothing was run.",
  stopped: "Stopped before this finished.",
  argumentsTooLong: "The arguments for this call were longer than this app accepts, so nothing was run. Try again with a shorter query or address.",
  argumentsNotValid: (name: string) => `The arguments for “${name}” were not valid JSON, so nothing was run. Try the call again with proper JSON.`,
};
