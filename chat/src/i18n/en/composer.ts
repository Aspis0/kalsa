// The chat composer and the brain's writing bar.

export const COMPOSER = {
  placeholder: "Write a message…",
  messageAria: "Message",
  send: "Send",
  stopGenerating: "Stop generating",
  attachAria: "Attach a file",
  thinkingOn: "Turn thinking on",
  thinkingOff: "Turn thinking off",
  hintSend: "Enter sends · Shift+Enter adds a line",
  hintOpening: "Opening the chat…",
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

export const BRAIN_BAR = {
  placeholder: "Say something…",
  writeAria: "Message",
  send: "Send",
  chat: "Chat",
  room: "Room",
  thisComputer: "This computer",
};
