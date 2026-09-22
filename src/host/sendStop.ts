/**
 * Stop: abort + the 3 s watchdog, over the turn fence.
 *
 * The watchdog exists because a native completion may never settle after
 * abort: at 3 s the UI unlocks for THAT run only. The order: retire the turn
 * FIRST so the engine's late finally no-ops every fence gate, then act
 * exactly once as the new owner — mark the streaming assistants interrupted
 * (dropping empty placeholders), persist in lockstep, then release the
 * composer locks. UI unlock while the engine FIFO is still wedged is
 * intentional.
 */
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";
import {
  regenHandleSendPassRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import type { Message } from "./hostMessage";
import type { TurnFence } from "./turnGuards";

export interface StopDeps {
  fence: TurnFence;
  abortRef: { current: AbortController | null };
  stopWatchdogRef: { current: ReturnType<typeof setTimeout> | null };
  /** Live run's token, as issued at send start. */
  currentTokenRef: { current: TurnFenceToken | null };
  sendingRef: { current: boolean };
  sendClaimRef: { current: boolean };
  sendingInFlightRef: { current: boolean };
  regenInFlightRef: { current: boolean };
  regenHandleSendPassRef: { current: boolean };
  stopRequestedRef: { current: boolean };
  messagesRef: { current: Message[] };
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  persist: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => HistoryWriteTicket | null;
  getEpoch: () => number;
  onSendingChange: (sending: boolean) => void;
}

/** Structural view of a turn token (the branded type stays opaque). */
type TurnFenceToken = NonNullable<Parameters<TurnFence["apply"]>[0]>;

/** The host-held half of `StopDeps` — the six fields `sendHost.ts` passes
 *  as `params`, so the factory below takes the send file's own object. */
export type StopHost = Pick<
  StopDeps,
  "fence" | "messagesRef" | "setMessages" | "persist" | "getEpoch" | "onSendingChange"
>;

/** The run-local refs the stop closure reads — MOVED OUT of `sendHost.ts`
 *  (whose 350-line ratchet the attachment snapshot pushed past): the stop
 *  HANDLER is unchanged, only where its closure is built. */
export type StopRefs = Pick<
  StopDeps,
  "abortRef" | "stopWatchdogRef" | "currentTokenRef" | "sendingRef" | "stopRequestedRef"
>;

export function createStopHandler(host: StopHost, refs: StopRefs): () => void {
  return () =>
    handleStop({
      ...host,
      ...refs,
      sendClaimRef: sendClaimRef as { current: boolean },
      sendingInFlightRef: sendingInFlightRef as { current: boolean },
      regenInFlightRef,
      regenHandleSendPassRef,
    });
}

export function handleStop(deps: StopDeps): void {
  const controller = deps.abortRef.current;
  if (!controller) return;
  controller.abort();
  deps.stopRequestedRef.current = true;
  // If native completion never settles after abort, unlock the composer
  // after 3s for the same run (mirrors the clear/switch ordering so a late
  // finally no-ops its fence gates).
  if (deps.stopWatchdogRef.current != null) {
    clearTimeout(deps.stopWatchdogRef.current);
    deps.stopWatchdogRef.current = null;
  }
  const tokenAtStop = deps.currentTokenRef.current;
  deps.stopWatchdogRef.current = setTimeout(() => {
    deps.stopWatchdogRef.current = null;
    if (!deps.sendingRef.current) return;
    if (tokenAtStop === null || deps.currentTokenRef.current !== tokenAtStop) return;
    // 1) Retire first, then own the post-retire state: the engine's late
    // finally sees a token nobody outside this callback holds.
    const ownedToken = deps.fence.retire();
    // 2) Mark streaming assistants interrupted + persist in lockstep;
    // empty placeholders (no streamed text) are dropped, as in the abort path.
    deps.setMessages((prev) =>
      deps.fence.apply(ownedToken, prev, (state) => {
        const next = state
          .filter((message) => !(message.streaming && !(message.text ?? "").trim()))
          .map((message) => {
            if (!message.streaming) return message;
            return {
              ...message,
              streaming: false,
              statusLabel: undefined,
              interrupted: true,
            };
          });
        deps.messagesRef.current = next;
        deps.persist(next, { epoch: deps.getEpoch() });
        return next;
      }),
    );
    // 3) Unlock only if the retired token still owns the post-retire state
    // (nothing began a new run in between).
    if (deps.fence.owns(ownedToken)) {
      deps.sendingRef.current = false;
      deps.sendingInFlightRef.current = false;
      deps.sendClaimRef.current = false;
      // Stop during an edit-triggered send: clear the shared lock state so
      // the composer does not stay busy.
      deps.regenInFlightRef.current = false;
      deps.regenHandleSendPassRef.current = false;
      deps.stopRequestedRef.current = false;
      deps.onSendingChange(false);
    }
  }, 3000);
}
