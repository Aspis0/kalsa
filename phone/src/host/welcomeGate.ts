/** The first-open block exists only after history settles on an empty chat. */
export function welcomeVisible(historyLoaded: boolean, messageCount: number): boolean {
  return historyLoaded && messageCount === 0;
}
