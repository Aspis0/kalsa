// The shell around every page: the top bar's own buttons, the banners, the
// attach flow's status line, the live-region sentences, and the app-owned
// sentences the storage and slot libraries report by code.

export const SHELL = {
  conversations: "Chats",
  files: "Files",
  toggleFilesAria: "Toggle the files panel",
  dismiss: "Dismiss",
  dropToAttach: "Drop files to attach them to this conversation",
  // The refusal banner when files cannot fit.
  tooMuchPlural: (names: string) => `${names} are too much for Kalsa at once. Remove a file or shorten your message.`,
  tooMuchSingular: (names: string) => `${names} is too much for Kalsa at once. Remove a file or shorten your message.`,
  refusalBody: "Nothing was attached.",
  // The attach flow's own line.
  checkingContext: "Checking the files fit…",
  readingOne: (name: string) => `Reading ${name}…`,
  readingMany: (count: number) => `Reading ${count} files…`,
  // The live region: one sentence per turn of its life.
  gateWaiting: "Kalsa wants to search the web. Allow it?",
  tooMuchAtOnce: "This is too much for Kalsa at once. Remove a file or shorten your message.",
  // A turn refused for size: what it had read was too much to answer in one
  // go. It says so without blaming the message or the files — the weight may
  // have come from what the turn read, not from what the person sent.
  readTooMuch: "Kalsa had too much to read for one answer.",
  // The turn was closed for space: the answer is what the turn found before
  // it stopped reading.
  spaceClosed: "Kalsa stopped reading here: this turn had read more than fits in one answer.",
  waitingFirstWord: "Kalsa is answering…",
  thinking: "Kalsa is thinking…",
  thinkingComplete: "Thinking complete, no answer arrived.",
  responseComplete: "Kalsa has answered.",
  responseStopped: "You stopped Kalsa. What it wrote is kept.",
  stoppedBeforeFinishing: "Kalsa stopped before finishing. Ask again.",
  attachedOne: (name: string) => `${name} attached.`,
  attachedMany: (count: number) => `${count} files attached.`,
  attachmentFailed: "Kalsa couldn't add this file. Choose it again.",
  // The storage and slot libraries report by code; the shell owns the words.
  storageFull: "Kalsa's storage is full, so new messages won't be saved. Delete old conversations to make room.",
  holdWaiting: "Waiting for Kalsa…",
  holdExpired: "Kalsa couldn't open this conversation. Try again.",
  doorSilent: "Kalsa couldn't open this conversation. Try again.",
  newConversation: "New conversation",
  untitled: "Untitled conversation",
};
