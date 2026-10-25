// The chat composer.

export const COMPOSER = {
  placeholder: "Write a message…",
  messageAria: "Message",
  send: "Send",
  stop: "Stop",
  attachAria: "Attach a file",
  think: "Think",
  thinkingOn: "Turn thinking on",
  thinkingOff: "Turn thinking off",
  // The browser control. It arms the next message and only the next one.
  browser: "Browse for me",
  browserOff: "Turn Browse for me off",
  browserTitle: "Can open websites, click and fill in pages for you.",
  browserOnTitle: "Browse for me is on: it applies to the next message only. Turn it off to cancel.",
  hintOpening: "Opening the chat…",
  disclaimer: "Kalsa can make mistakes. Check important information.",
  thinkingOnTitle: "Thinking is on: Kalsa works the question through before it answers. Turn it off to answer at once.",
  thinkingOffTitle: "Thinking is off: Kalsa answers at once.",
  compressing: (pct: number) => `Compressing… ${pct}%`,
  attachTitle: "Attach a file (text, markdown, CSV, PDF, Word, PowerPoint)",
  attachTitleImages:
    "Attach a file or picture (text, markdown, CSV, PDF, Word, PowerPoint, images)",
  attachTitleMedia: "Attach a picture or video",
  removeImage: "Remove this picture",
  removeDoc: "Remove this document",
};
