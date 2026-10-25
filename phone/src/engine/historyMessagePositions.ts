export type HistoryMessagePosition = {
  userIndex: number;
  finalAssistantIndex: number;
};

/** Identify the current user and an assistant-terminated history's final turn. */
export function historyMessagePositions(
  messages: ReadonlyArray<{ role: string }>,
): HistoryMessagePosition {
  const lastIndex = messages.length - 1;
  const lastRole = messages[lastIndex]?.role;
  const userIndex = lastRole === "user" ? lastIndex : -1;
  const finalAssistantIndex =
    userIndex < 0 && lastRole === "assistant" ? lastIndex : -1;
  return { userIndex, finalAssistantIndex };
}
