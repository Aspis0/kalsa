// The files story: the panel beside the chat, the fit bar above it, and why
// a file could not be attached.

export const FILES = {
  panelAria: "Files",
  tabsAria: "Files panel",
  filesTab: "Files",
  attachedTab: "Attached",
  closeAria: "Close panel",
  empty: "Add a document so Kalsa can use it in this conversation. Drop it here, use the paperclip, or pick one from Files.",
  remove: "Remove",
  reattach: "Reattach",
  previouslyAttached: "Previously attached",
  onePage: "1 page",
  pages: (count: number) => `${count} pages`,
  // The fit bar: labelled segments, no numbers.
  budgetUnknown: "Kalsa can't check whether these files fit, so she may not use all of them.",
  budgetFiles: "Files",
  budgetEarlier: "Earlier messages",
  budgetKept: "Kept for Kalsa's answer",
  budgetFree: "Free",
  budgetOver: "Too much for Kalsa at once. Remove a file or shorten your message.",
  // Why a file could not be attached, by the failure the extractor reports.
  unsupportedKind: "Kalsa can't read this kind of file. Use a text document, PDF, Word or PowerPoint file.",
  unsupportedLegacy: (app: string) => `This file is in an old format. Open it in ${app}, save a new copy, and attach that.`,
  tooBig: "This file is too large for Kalsa. Try a smaller one.",
  unreadable: "Kalsa couldn't read this file. It may be damaged or locked with a password.",
  noText: "Kalsa found no words in this file. If it's a scan, she can't read it yet.",
  couldNotOpen: "Kalsa couldn't open this file. Choose it again.",
};
