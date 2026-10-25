/**
 * Wait out a chat load another owner holds — the double-load backstop's
 * refusal (`engineEnsure` gate `chat_loading`) means a load is mid-flight
 * and SUCCEEDING, never that this model failed. One responsibility: telling
 * the send path when that other load has settled (or that there was none).
 *
 * No wall-clock bound: every ensure exit releases the gate (ready, error, or
 * catch), and the waiting turn is stoppable — an abort resolves `aborted`
 * at once. A timeout would only resurrect the false load-failed copy for a
 * slow-but-succeeding load; the user's stop is the bound instead.
 */
import { getState } from "../engine/llamaContextGate";

export type InFlightLoadWait =
  /** No other load owns the gate: the refusal was real, classify it as-is. */
  | "none"
  /** The other load settled; a retry may now acquire. */
  | "settled"
  /** The waiting turn was stopped; the caller must end without a verdict. */
  | "aborted";

const CHAT_LOAD_POLL_MS = 250;

/** Resolve early on abort so a stop never waits out a poll interval. */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForInFlightChatLoad(
  signal?: AbortSignal,
): Promise<InFlightLoadWait> {
  if (getState() !== "chat_loading") return "none";
  while (signal?.aborted !== true) {
    if (getState() !== "chat_loading") return "settled";
    await sleepWithAbort(CHAT_LOAD_POLL_MS, signal);
  }
  return "aborted";
}
