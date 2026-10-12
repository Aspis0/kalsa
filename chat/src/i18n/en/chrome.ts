// The shared chrome and the Settings page.

export const CHROME = {
  home: "Home",
  room: "Room",
  chat: "Chat",
  settings: "Settings",
  navigation: "Pages",
  // The settings surfaces' names, keyed as the shell looks them up.
  pages: {
    "help": "Help",
    "models": "Your AI",
    "devices": "Phones",
    "settings": "Settings",
  } as Record<string, string>,
  showConversations: "Show chats",
};

export const SETTINGS = {
  title: "Settings",
  look: "Look",
  lookLight: "Light",
  lookDark: "Dark",
  lookAuto: "Automatic",
  webSearch: "Let Kalsa search the web",
  webSearchHint: "Only the search words go online. Your chats stay here.",
  webSearchMore: "What leaves this computer?",
  webSearchNote:
    "When your question needs something current, the assistant can search the web and open a page. That search — the words it chose, and the address it opens — leaves this computer for a search service on the internet, and what comes back is kept in the conversation. With this off, web searches and page requests are not sent and the assistant answers from what it already knows. This switch is applied as soon as you change it.",
  lede: "Your messages and answers stay on this computer.",
  language: "Language",
  languageSystem: "System default",
  ai: "AI",
  usingAi: (name: string) => `Using ${name}`,
  aiDetails: "Change or see details",
};
