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
