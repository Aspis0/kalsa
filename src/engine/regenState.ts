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
 * discardInFlightRef / discardGenerationRef: AppShell background/inactive
 * discard is single-flight. React Native can emit both events; a second
 * discard no-ops while the first is in flight. After a discard finishes
 * (dispose or early bail), discardGenerationRef bumps so a send that
 * started under the previous generation can detect engine teardown and
 * re-acquire via ensureEngineForModel.
 *
 * pendingModelSwitchQueue: when selectModelById runs while sendClaimRef is
 * held (pre-send fit-gate await), the switch is deferred (last-wins queue)
 * and applied after the claim releases.
 *
 * Owner pattern (generation counter):
 *   regenGenerationRef is the single shared owner token for EVERY lock above
 *   (sendClaim, regenInFlight, regenHandleSendPass, regenAbort).
 *   - clearChat (and hard reset) bumps the counter, then clears locks.
 *   - On acquire: capture `const myGen = regenGenerationRef.current`.
 *   - In finally: only release if `regenGenerationRef.current === myGen`.
 *   A stale flow whose finally runs after clearChat + a new acquire therefore
 *   cannot clobber the new owner's locks (generation mismatch → skip).
 */
export const regenInFlightRef: { current: boolean } = { current: false };
export const regenHandleSendPassRef: { current: boolean } = { current: false };
export const regenAbortRef: { current: AbortController | null } = {
  current: null,
};
export const sendingInFlightRef: { current: boolean } = { current: false };
export const sendClaimRef: { current: boolean } = { current: false };
/** Shared owner generation for all locks in this module. Bumped by clearChat. */
export const regenGenerationRef: { current: number } = { current: 0 };

/**
 * True while AppShell's background/inactive discard async is running.
 * A second AppState event must no-op rather than race dispose.
 */
export const discardInFlightRef: { current: boolean } = { current: false };
/**
 * Bumped when a discard cycle finishes (dispose or early bail). A send that
 * captured an older generation and finds the engine gone re-acquires.
 */
export const discardGenerationRef: { current: number } = { current: 0 };

/**
 * Deferred model-id switches while a send holds sendClaimRef.
 * Last entry wins when drained.
 */
export const pendingModelSwitchQueue: string[] = [];

/**
 * If a send claim is held, queue `modelId` and return true (caller must not
 * switch now). Otherwise return false (caller proceeds immediately).
 */
export function deferModelSwitchIfSendClaimed(modelId: string): boolean {
  if (!sendClaimRef.current) return false;
  pendingModelSwitchQueue.push(modelId);
  return true;
}

/**
 * Drain the pending model-switch queue (last-wins). Returns null if empty.
 * Caller applies the returned id via selectModelById / selectModel.
 */
export function drainPendingModelSwitch(): string | null {
  if (pendingModelSwitchQueue.length === 0) return null;
  const id = pendingModelSwitchQueue[pendingModelSwitchQueue.length - 1]!;
  pendingModelSwitchQueue.length = 0;
  return id;
}

export type BackgroundDiscardResult = {
  /** Real historyHash of the messages that were (or will be) saved. */
  historyHashValue: string;
  /** Length of the persistable messages array that produced historyHashValue. */
  historyMessageCount: number;
};

export const backgroundDiscardLifecycleRef: {
  current: (() => Promise<BackgroundDiscardResult>) | null;
} = { current: null };
