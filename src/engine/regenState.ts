/**
 * Module-level regen lock shared by AiChatPage (setter) and AppShell (reader).
 * Prevents model switch / concurrent regen while edit or regenerate is running.
 * Plain object refs — no React import (import-clean for harnesses / AppShell).
 *
 * regenHandleSendPassRef: one-shot allow so regenerate/edit can call handleSend
 * while regenInFlightRef is true (without the busy check deadlocking itself).
 */
export const regenInFlightRef: { current: boolean } = { current: false };
export const regenHandleSendPassRef: { current: boolean } = { current: false };
