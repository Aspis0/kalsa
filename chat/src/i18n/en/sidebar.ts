// The drawer of past conversations: search, the groups the days fall into,
// and what one row can do.

export const SIDEBAR = {
  aria: "Conversations",
  searchAria: "Search conversations",
  searchPlaceholder: "Search",
  focusSearch: "Focus search",
  newChat: "+ New chat",
  titleAria: "Conversation title",
  rename: "Rename",
  sure: "Delete this conversation?",
  delete: "Delete",
  liveAria: " (generating)",
  noMatch: (query: string) => `No conversations match “${query}”. Try another word.`,
  capped: (shown: number, total: number) => `Showing ${shown} of ${total}. Add a word to narrow it down.`,
  groups: {
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This week",
    earlier: "Earlier",
  } as Record<string, string>,
};
