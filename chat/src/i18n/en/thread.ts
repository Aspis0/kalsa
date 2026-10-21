// The conversation's own view: the answer's failures and retries, the
// thinking cloud above the answer, and the jump back to the latest.

export const THREAD = {
  // The failures a request can end in, each a title and the sentence that
  // says what the owner can do about it.
  couldntAnswerTitle: "Kalsa couldn't answer.",
  couldntAnswerBody: "Turn Kalsa off and on again from Home.",
  notRunningTitle: "Kalsa isn't running on this computer.",
  notRunningBody: "Turn it on from Home.",
  stoppedTitle: "Kalsa stopped answering after a minute without new words.",
  stoppedBody: "Try again.",
  tooMuchTitle: "Kalsa had too much to read for one answer.",
  tooMuchBody: "Ask for less at a time, or start a new chat.",
  tryAgainTitle: "Kalsa couldn't answer just now.",
  tryAgainBody: "Wait a moment, then try again.",
  stoppedHalfwayTitle: "The answer stopped halfway.",
  stoppedHalfwayBody: "The connection closed before the end. What arrived is above. Try again for the full answer.",
  tryAgain: "Try again",
  turnKalsaOn: "Turn Kalsa on",
  engineOffBody: "Kalsa is off.",
  interruptedNote: "The answer was interrupted.",
  interruptedRetry: "Retry",
  waitingFirstWord: "Waiting for the first word",
  readingMessage: "Reading your message…",
  stoppedEarly: "Reply stopped.",
  noAnswer: "Kalsa did not produce an answer. Try rephrasing your question.",
  backToLatest: "Back to latest ↓",
  copyAnswer: "Copy answer",
  threadAria: "Conversation",
  // The thinking cloud.
  thinking: "Thinking",
  thinkingDots: "Thinking…",
  thoughtUnderASecond: "Thought for less than a second",
  thoughtFor: (seconds: string) => `Thought for ${seconds} s`,
  hide: "Hide ▲",
  showThinking: "Show thinking ▼",
  thinkingAria: "Kalsa's thoughts",
  videoPlay: "Play video",
  videoLabel: "Video",
  videoMissing: "Video unavailable",
  videoNotKept: "The video was not saved. Kalsa saw only some of the frames.",
  // The box where a picture's bytes are gone (storage cleared elsewhere).
  imageMissing: "Picture unavailable",
};
