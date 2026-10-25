// The computer's half of the files panel: the roots, the tree, and the
// search that answers as it finds.

export const BROWSER = {
  home: "Home",
  searchHere: "Search here",
  attach: "Attach",
  readingFolder: "Reading the folder…",
  truncated: "Showing the first 500 items, alphabetically.",
  skippedEntries: (count: number) => `${count} entries here could not be read.`,
  notDesktop: "Browsing this computer’s disk is only available in the desktop app.",
  searchPlaceholder: "Search by name or path",
  searchButton: "Search",
  searchingIn: (scope: string) => `Searching in ${scope}`,
  looking: "…",
  noScope: "No folder to search in yet.",
  viaIndex: "Results come from this Mac’s file index, which skips hidden files and some folders. ",
  skippedSome: (count: number) => `Skipped ${count} entries the system would not show. `,
  limited: "Showing the first 500. Be more specific to see the rest.",
  readingFolders: "Reading this computer’s folders…",
  folder: "folder",
};

/**
 * The card a person is asked about, and the Pausa control.
 *
 * **The two answers are the whole of it.** Everything else here is telling a
 * person what a stranger's site is about to receive, so the wording is about
 * what is being sent rather than about Kalsa: the button says what it does to
 * the request, not what it does to the model.
 */
export const CONFIRM = {
  wantsToSend: (host: string) => `${host} wants to send:`,
  /** Said under the host when the request goes over plain `http`. */
  insecure: "Not a secure connection",
  waiting: "Nothing has been sent yet.",
  /** The method is the site's own word, so it is shown as it stands. */
  allow: "Send it",
  decline: "Don't send it",
  asking: "Sending…",
  none: "No fields — just the request.",
  /** **A card with no destination.** Said instead of a host, because this
   *  computer could not name where the request goes, and a name guessed here
   *  would be the one thing on the card that must not be a guess. */
  nowhere: "Somewhere this computer cannot name.",
  nowhereWhy: "Nothing here can be sent. You can still turn it down.",
  paused: "Paused",
  resume: "Resume",
  pauseHint: "Pausing stops the next action. What has already been sent cannot be recalled.",
  runningHint: "Paused. Kalsa is not acting in the browser.",

  /** What became of the request a person just answered, in their own words:
   *  the one thing they are told about it after the card goes. */
  sentTo: (host: string) => `Sent to ${host}`,
  show: "Show",
  hide: "Hide",
  notSentNo: "Not sent — it was not allowed",
  notSentLate: "Not sent — nobody answered in time",
  notSentGone: "Not sent — the browser window closed",
  notSentHidden: "Not sent — it could not be shown to you",
  unclear: "Unclear — it may have been sent",
};
