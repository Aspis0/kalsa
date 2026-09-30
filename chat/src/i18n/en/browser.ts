// The computer's half of the files panel: the roots, the tree, and the
// search that answers as it finds.

export const BROWSER = {
  home: "Home",
  searchHere: "Search here",
  attach: "Attach",
  readingFolder: "Reading the folder…",
  truncated: "First 500 of this folder shown, alphabetically.",
  skippedEntries: (count: number) => `${count} entries here could not be read.`,
  notDesktop: "This tab browses this computer’s disk, which only the desktop app can do.",
  searchPlaceholder: "Search by name or path",
  searchButton: "Search",
  searchingIn: (scope: string) => `Searching in ${scope}`,
  looking: " — looking…",
  noScope: "No folder to search in yet.",
  viaIndex: "Answered by this Mac’s fast index — files the index skips (dotfiles, some folders) are missing from these results. ",
  skippedSome: (count: number) => `Skipped ${count} entries the system would not show. `,
  limited: "First 500 shown — narrower words reach the rest.",
  readingFolders: "Reading this computer’s folders…",
  folder: "folder",
};
