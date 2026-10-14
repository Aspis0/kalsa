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
    "mail": "Mail",
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
  webSearchHint: "Only the search words go online. Your chats stay on this computer.",
  webSearchMore: "What leaves this computer?",
  webSearchNote:
    "When a question needs current information, Kalsa can search the web and open pages. Each search sends the words Kalsa chose, and the address of any page it opens, to a search service on the internet. The results stay in the conversation. With this off, nothing is searched or requested, and Kalsa answers from what it already knows.",
  lede: "Your messages and answers stay on this computer.",
  language: "Language",
  languageSystem: "System default",
  ai: "AI",
  usingAi: (name: string) => `Using ${name}`,
  aiDetails: "Change or see details",
  mail: "Mail",
  mailHint: "Read your mailbox in the chat, and reply.",
  mailOpen: "Set up mail",
};
