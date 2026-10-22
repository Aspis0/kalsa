// What Kalsa did before it answered: the quiet line per check, the ask
// before a web call leaves an app with documents attached, what the detector
// saw, and the refusals a tool round can end in.

export const TOOLS = {
  checking: "Kalsa is checking something…",
  searching: "Searching the web…",
  openingPage: "Opening a page…",
  waitingForOk: "Waiting for your OK…",
  // A running mail call: a real mailbox read is silent for seconds.
  readingMail: "Reading your mail…",
  writingDraft: "Writing the draft…",
  writingCardLines: "Writing a line under each card…",
  mailReady: "Your mail is ready.",
  pageNotOpened: "Kalsa couldn't open that page. Try again.",
  searchDidNotRun: "Kalsa couldn't search the web. Try again.",
  // The browser row says what happened and nothing else: no address (the model
  // wrote it, a page wrote the others) and no page text.
  browserOpened: "Kalsa opened a page in the browser.",
  browserRead: "Kalsa read the page.",
  browserFound: "Kalsa looked for the text on the page.",
  browserClicking: "Kalsa clicked something on the page.",
  browserTyped: "Kalsa wrote into a field on the page.",
  browserShot: "Kalsa took a picture of the page.",
  browserDidNotRun: "Kalsa did not do that in the browser.",
  couldNotFinish: "Kalsa couldn't finish checking. Ask again.",
  read: (what: string) => `Kalsa read ${what}`,
  aPage: "a page",
  searchedWeb: "Searched the web",
  searchedForLabel: "Searched for:",
  askedForLabel: "Asked for:",
  // A search reads its own best pages before it answers (searchPages.ts), so
  // the card says how many rather than letting the reader assume it did.
  pagesReadLabel: "Pages read:",
  // The gate's ask.
  searchWaitingTitle: "Kalsa wants to search the web. Allow it?",
  pageWaitingTitle: "Kalsa wants to open a web page. Allow it?",
  gateWhy: (docs: string) => `${docs}, so Kalsa shows you what it would send online before sending it.`,
  oneDocument: "One document is attached",
  documentsAttached: (count: number) => `${count} documents are attached`,
  mailOnly: "This chat holds your mail",
  andMail: " and this chat holds your mail",
  exactTextSearch: "Kalsa would search the web for:",
  exactTextPage: "Kalsa would open this address:",
  findingFrom: (source: string) => ` from ${source}`,
  nothingRecognisable: "Nothing recognisable was found in it.",
  oneMoreWaiting: "Kalsa has 1 more to check after this one.",
  moreWaiting: (count: number) => `Kalsa has ${count} more to check after this one.`,
  sendIt: "Send it",
  refuse: "Refuse",
  // The one-time notice, before this install's first search: the provider's
  // own name is read from the code that sends the query, never written here.
  noticeTitle: "Search the web?",
  noticeBody: (provider: string) =>
    `Kalsa will send the search to ${provider}. ${provider} sees the search words and your internet address. Your conversation stays on this computer.`,
  noticeGo: "Search",
  noticeNotNow: "Not now",
  webSearchFailed: "Kalsa couldn't search the web just now. Try again.",
  webPageTooLong: "That page is too long for Kalsa to read.",
  linkNotInChat: "Kalsa didn't open that link: it hasn't appeared in this chat.",
  linkHasCredential: "Kalsa didn't open that link: it looks like it carries a password or key.",
  searchLinkNotInChat: "Kalsa didn't search: that link hasn't appeared in this chat.",
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
  notOffered: "That tool is not available now. Answer without it.",
  // **The browser turn's own refusal.** The person armed the browser for this
  // message, and a model that reaches for the web tools anyway has to be told
  // that this turn is the browser's — the tool list alone does not say it.
  // **Fixed in English in every language on purpose**: the model may not read
  // the owner's language, and a sentence it cannot read is a sentence it will
  // try again.
  notOfferedBrowser: "The person asked you to browse for them this turn. Use the browser tools.",
  // The badge under a message that was sent armed: the turn was the browser's.
  browserBadge: "browser",
  // **What Kalsa did, said once at the end of a browser turn**, and the words for
  // every code a browser call can come back with. Five tables over one set of
  // facts: the line the person reads and the line the model reads are the same.
  recap: {
    lede: "Kalsa did:",
    joiner: " · ",
    openedSome: "opened a page",
    askedFor: (host: string) => `asked for ${host}`,
    read: (n: number) => `read the page ${n} ${n === 1 ? "time" : "times"}`,
    typed: (n: number) => `written into ${n} ${n === 1 ? "field" : "fields"}`,
    clicked: (n: number) => `clicked ${n} ${n === 1 ? "time" : "times"}`,
    clickInterrupted: "click interrupted",
    noClick: "no click",
    waiting: (n: number) => `${n} waiting for your answer`,
    sent: (n: number, where: string) => `${n} sent to ${where}`,
    declined: (n: number) => `${n} not sent`,
    expired: (n: number) => `${n} expired without an answer`,
    gone: (n: number) => `${n} lost when the window closed`,
    unsendable: (n: number) => `${n} could not be sent`,
    unclear: (n: number) => `${n} cannot be accounted for`,
    interrupted: "interrupted",
    aSite: "a site",
    windowGone: "You closed the browser window.",
    refused: "The browser would not do that.",
    failed: "The browser could not be reached.",
    noPage: "There was no page open there.",
    elementGone: "That element is no longer on the page.",
    fieldGone: "That field is no longer on the page.",
    held: "The request is waiting for you. Nothing was sent.",
    invalid: "The form would not let it go.",
    paused: "You asked Kalsa to stop in the browser.",
    busy: "Kalsa is busy with the browser.",
    noPendingRequest: "That request is not waiting for an answer any more.",
    deterministic: "That failed the same way once already.",
    tooManySteps: "That is more browser steps than a turn may take.",
    alreadyRun: "That was already done.",
    readAgain: "Kalsa had already read that part of the page.",
  },
};
