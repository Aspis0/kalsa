// The shell around every page: the top bar's own buttons, the banners, the
// attach flow's status line, the live-region sentences, and the app-owned
// sentences the storage and slot libraries report by code.

export const SHELL = {
  conversations: "Conversations",
  backTo: (label: string) => `Back to ${label}`,
  files: "Files",
  toggleFilesAria: "Toggle the files panel",
  dismiss: "Dismiss",
  dropToAttach: "Drop files to attach them to this conversation",
  crescentChat: "Crescent Chat",
  // The refusal banner when files cannot fit.
  dontFit: (names: string) => `${names} don't fit.`,
  doesntFit: (names: string) => `${names} doesn't fit.`,
  refusalBody: (file: string, history: string, reserve: string, need: string, have: string) => ` File ≈${file} + history ≈${history} + ≈${reserve} kept free for the answer = ≈${need} of ≈${have} context tokens. Nothing was attached or cut.`,
  oversizeDetail: (file: string, history: string, reserve: string, need: string, have: string) => `≈${file} file + ≈${history} history + ≈${reserve} kept free for the answer = ≈${need} of ≈${have} context tokens.`,
  // The attach flow's own line.
  checkingContext: "Checking context size…",
  readingOne: (name: string) => `Reading ${name}…`,
  readingMany: (count: number) => `Reading ${count} files…`,
  // The live region: one sentence per turn of its life.
  gateWaiting: "A web call is waiting for your say-so.",
  noLongerFits: "The message no longer fits the context.",
  waitingFirstWord: "Responding. Waiting for the first word.",
  thinking: "Thinking.",
  responding: "Responding.",
  thinkingComplete: "Thinking complete, no answer arrived.",
  responseComplete: "Response complete.",
  responseStopped: "Response stopped. Partial text kept.",
  stoppedHalfway: "The answer stopped halfway. Details shown in the conversation.",
  responseFailed: "The response failed. Error details shown in the conversation.",
  attachmentRefused: "Attachment refused: it does not fit the context.",
  attachedOne: (name: string) => `${name} attached.`,
  attachedMany: (count: number) => `${count} files attached.`,
  attachmentFailed: "Attachment failed.",
  // The storage and slot libraries report by code; the shell owns the words.
  storageFull: "Browser storage is full — new messages are kept for this session only and will be lost on reload.",
  holdWaiting: "Waiting for this computer's door to become reachable…",
  holdExpired: "This computer's door did not become reachable in time. Try again.",
  doorSilent: "The door did not answer, so the state of this device's slot is unknown.",
  newConversation: "New conversation",
  untitled: "Untitled conversation",
};
