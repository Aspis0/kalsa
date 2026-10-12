// The files story: the panel beside the chat, the fit bar above it, and why
// a file could not be attached.

export const FILES = {
  panelAria: "Files",
  tabsAria: "Files panel",
  filesTab: "Files",
  attachedTab: "In this chat",
  closeAria: "Close panel",
  empty: "Add a document to this conversation. Drop it here, press Attach a file, or pick one from Files.",
  remove: "Remove",
  reattach: "Reattach",
  pinName: "Keep",
  pinDoc: "Keep sends the file with every message.",
  previouslyAttached: "Previously attached",
  readNext: "Read with your next message",
  onePage: "1 page",
  pages: (count: number) => `${count} pages`,
  // The fit's sentences: unknown size, nearly full, too much.
  budgetUnknown: "Kalsa can't check whether these files fit, so it may not use all of them.",
  budgetAlmostFull: "This conversation is almost full: Kalsa may not read everything. Remove a file or start a new conversation.",
  budgetOver: "Too much for Kalsa at once. Remove a file or shorten your message.",
  // Why a file could not be attached, by the failure the extractor reports.
  unsupportedKind: "Kalsa can't read this kind of file. Use a text, PDF, Word or PowerPoint file.",
  unsupportedLegacy: (app: string) => `This file is in an old format. Open it in ${app}, save a new copy, and attach that.`,
  tooBig: "This file is too large for Kalsa. Try a smaller one.",
  unreadable: "Kalsa couldn't read this file. It may be damaged or password-protected.",
  emptyFile: "This file is empty.",
  noText: "Kalsa found no text in this file. Scanned files can't be read yet.",
  couldNotOpen: "Kalsa couldn't open this file. Choose it again.",
};
