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
 */
export const regenInFlightRef: { current: boolean } = { current: false };
export const regenHandleSendPassRef: { current: boolean } = { current: false };
export const regenAbortRef: { current: AbortController | null } = {
  current: null,
};
export const sendingInFlightRef: { current: boolean } = { current: false };

export type BackgroundDiscardResult = {
  /** Real historyHash of the messages that were (or will be) saved. */
  historyHashValue: string;
};

export const backgroundDiscardLifecycleRef: {
  current: (() => Promise<BackgroundDiscardResult>) | null;
} = { current: null };
