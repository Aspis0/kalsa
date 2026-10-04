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
  tooMuchTitle: "This message and its files are too much for Kalsa at once.",
  tooMuchBody: "Remove a file or shorten your message.",
  tryAgainTitle: "Kalsa couldn't answer just now.",
  tryAgainBody: "Wait a moment, then try again.",
  stoppedHalfwayTitle: "The answer stopped halfway.",
  stoppedHalfwayBody: "The connection closed before the end — what arrived is above. Try again for the full answer.",
  tryAgain: "Try again",
  waitingFirstWord: "Waiting for the first word",
  stoppedEarly: "Stopped early — showing what arrived.",
  noAnswer: "Kalsa finished thinking without an answer. Try asking another way.",
  backToLatest: "Back to latest ↓",
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
  videoNotKept: "The video itself wasn't kept — Kalsa saw its frames.",
  // The box where a picture's bytes are gone (storage cleared elsewhere).
  imageMissing: "Picture unavailable",
};
