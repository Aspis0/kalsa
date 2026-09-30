// The conversation's own view: the answer's failures and retries, the
// thinking cloud above the answer, and the jump back to the latest.

export const THREAD = {
  // The six failures a request can end in, each a title and the sentence
  // that says what the owner can do about it.
  refusedTitle: "The server refused the key.",
  refusedBody: "It answered 403 — the key works but is not allowed here. Check it in Settings and try again.",
  unacceptedTitle: "The server did not accept the key.",
  unacceptedBody: "It answered 401 — the token is missing, wrong, or expired. Check it in Settings and try again.",
  unreachableTitle: "The server could not be reached.",
  unreachableBody: "Check the address in Settings and that the server is running, then try again.",
  notAStreamTitle: "The server answered, but not as a chat stream.",
  notAStreamBody: "The reply was not event-stream data — this address may serve a web page or a different API. Check it in Settings and try again.",
  stoppedHalfwayTitle: "The answer stopped halfway.",
  stoppedHalfwayBody: "The connection closed before the end — what arrived is above. Try again for the full answer.",
  tooSlowTitle: "The server took too long to answer.",
  tooSlowBody: "A full minute with no new words, so the request was dropped. Try again.",
  exceedsTitle: "This exceeds the context.",
  exceedsBody: "Even without the older turns, this message plus its attachments don't fit. Remove a file or shorten the message.",
  errorTitle: "The server answered with an error.",
  errorBody: (status: number | undefined) => `It answered ${status ?? "with an error"}. Wait a moment and try again.`,
  called: (url: string) => `Called: ${url}`,
  tryAgain: "Try again",
  waitingFirstWord: "Waiting for the first word",
  stoppedEarly: "Stopped early — showing what arrived.",
  noAnswer: "The model thought but gave no answer.",
  backToLatest: "Back to latest ↓",
  threadAria: "Conversation",
  // The thinking cloud.
  thinking: "Thinking",
  thinkingDots: "Thinking…",
  thoughtUnderASecond: "Thought for less than a second",
  thoughtFor: (seconds: string) => `Thought for ${seconds} s`,
  hide: "Hide ▲",
  showThinking: "Show thinking ▼",
  thinkingAria: "Model thinking",
};
