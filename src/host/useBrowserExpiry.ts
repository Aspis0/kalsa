/**
 * The one clock that ends a browser card's budget for the whole conversation.
 *
 * The card watches its own deadline while it is drawn, and that is enough for
 * what the person SEES. It is not enough for what the phone HOLDS: the
 * transcript virtualizes, so a card scrolled out of view is unmounted and its
 * timer is gone — and §6 does not care whether anyone was looking. A card past
 * its budget gives its values back anyway.
 *
 * So the conversation sweeps once a second, across every message, mounted or
 * not. It costs a map and, on every tick where nothing has expired, the same
 * array back — which React bails out of, so an idle conversation does no work
 * a person can notice.
 */
import { useEffect } from "react";

import { monotonicNowMs } from "../domain/browserCardPayload";
import { expireBrowserCards } from "./browserCardState";
import type { Message } from "./hostMessage";

/** The same beat the card ticks on, so the two agree about the moment a budget
 *  ran out rather than straddling it. */
const SWEEP_MS = 1000;

export function useBrowserExpiry(
  setMessages: (updater: (prev: Message[]) => Message[]) => void,
): void {
  useEffect(() => {
    const sweep = () => setMessages((prev) => expireBrowserCards(prev, monotonicNowMs()));
    sweep();
    const timer = setInterval(sweep, SWEEP_MS);
    return () => clearInterval(timer);
  }, [setMessages]);
}