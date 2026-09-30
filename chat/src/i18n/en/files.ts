// The files story: the panel beside the chat, the budget bar above it, and
// why a file could not be attached.

export const FILES = {
  panelAria: "Files",
  tabsAria: "Files panel",
  filesTab: "Files",
  attachedTab: "Attached",
  closeAria: "Close panel",
  empty: "No files attached. Drop a text, markdown, CSV, PDF, Word or PowerPoint file on the conversation, use the clip in the composer, or pick one from this computer under Files.",
  remove: "Remove",
  reattach: "Reattach",
  previouslyAttached: "Previously attached",
  onePage: "1 page",
  pages: (count: number) => `${count} pages`,
  tokens: (count: string) => `≈${count} tokens`,
  // The budget bar's terms, each carrying its own number.
  budgetUnknown: "Context size unknown — files attach unchecked.",
  filesTerm: (count: string) => `${count} files`,
  conversationTerm: (count: string) => `${count} conversation`,
  reservedTerm: (count: string) => `${count} reserved`,
  leftTerm: (count: string) => `${count} left`,
  overTerm: (count: string) => `${count} over`,
  ofTotal: (count: string) => `of ${count}`,
  // Why a file could not be attached, by the failure the extractor reports.
  unsupportedKind: (name: string) => `“${name}” is not a readable kind. Text, markdown, CSV, PDF, Word and PowerPoint files work.`,
  unsupportedLegacy: (name: string, app: string, modern: string) => `“${name}” is in ${app}’s older format (before 2007). Saving it as .${modern} and attaching that copy works.`,
  tooBig: (name: string, mb: string) => `“${name}” is too large to read in the browser (${mb} MB).`,
  unreadable: (name: string) => `“${name}” could not be read. The file may be damaged or protected.`,
  noText: (name: string) => `“${name}” holds no readable text (a scan without a text layer reads as blank).`,
  couldNotRead: "That file could not be read.",
  notFromComputer: (name: string) => `${name} could not be read from this computer.`,
};
