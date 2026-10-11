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
  thinkingOnTitle: "Thinking: the model reasons before answering. Turn it off to be answered at once.",
  thinkingOffTitle: "Thinking off: the model answers at once, without reasoning first.",
  compressing: (pct: number) => `Compressing… ${pct}%`,
  attachTitle: "Attach a file (text, markdown, CSV, PDF, Word, PowerPoint)",
  attachTitleImages:
    "Attach a file or picture (text, markdown, CSV, PDF, Word, PowerPoint, images)",
  attachTitleMedia: "Attach a picture or video",
  removeImage: "Remove this picture",
  removeDoc: "Remove this document",
};
