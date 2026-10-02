// The shared chrome and the Settings page.

export const CHROME = {
  home: "Home",
  room: "Room",
  chat: "Chat",
  settings: "Settings",
  settingsAria: "Settings",
  chatMenu: "Chat menu",
  // The settings surfaces' names, keyed as the shell looks them up.
  pages: {
    "models": "AI",
    "server": "Power",
    "devices": "Devices",
    "settings": "Settings",
  } as Record<string, string>,
  showConversations: "Show conversations",
};

export const SETTINGS = {
  title: "Settings",
  darkTheme: "Dark theme",
  webSearch: "Let the assistant search the web",
  webSearchNote:
    "When your question needs something current, the assistant can search the web and open a page. That search — the words it chose, and the address it opens — leaves this computer for a search service on the internet, and what comes back is kept in the conversation. With this off, nothing is sent and the assistant answers from what it already knows. This switch is applied as soon as you change it.",
  lede: "Your messages are answered on this computer, and everything stays here.",
  saved: "Saved.",
  save: "Save",
  language: "Language",
  languageSystem: "System default",
};
