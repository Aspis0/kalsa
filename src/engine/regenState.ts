/**
 * Module-level regen lock shared by AiChatPage (setter) and AppShell (reader).
 * Prevents model switch / concurrent regen while edit or regenerate is running.
 * Plain object refs — no React import (import-clean for harnesses / AppShell).
 *
 * regenHandleSendPassRef: one-shot allow so regenerate/edit can call handleSend
 * while regenInFlightRef is true (without the busy check deadlocking itself).
 *
 * regenAbortRef: AbortController for the active regen/edit. Background disposal
 * aborts it before awaiting lifecycle / dispose.
 *
 * backgroundDiscardLifecycleRef: AiChatPage registers an abort-and-await
 * lifecycle so AppShell can stop mid-turn generation, wait for save, then
 * dispose with the real historyHash.
 *
 * sendingInFlightRef: mirror of AiChatPage.sendingRef so AppShell can wait
 * without reaching into React state.
 *
 * sendClaimRef: synchronous pre-await claim so two rapid handleSend entries
 * cannot both pass the busy check and both enter the uncached fit gate.
 *
 * regenGenerationRef: bumped by clearChat; regen/edit capture the value at
 * entry and only null regenAbortRef in finally when generation still matches
 * (prevents a stale finally from clearing a newer controller).
 */
export const regenInFlightRef: { current: boolean } = { current: false };
export const regenHandleSendPassRef: { current: boolean } = { current: false };
export const regenAbortRef: { current: AbortController | null } = {
  current: null,
};
export const sendingInFlightRef: { current: boolean } = { current: false };
export const sendClaimRef: { current: boolean } = { current: false };
export const regenGenerationRef: { current: number } = { current: 0 };

export type BackgroundDiscardResult = {
  /** Real historyHash of the messages that were (or will be) saved. */
  historyHashValue: string;
};

export const backgroundDiscardLifecycleRef: {
  current: (() => Promise<BackgroundDiscardResult>) | null;
} = { current: null };
