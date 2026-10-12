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
