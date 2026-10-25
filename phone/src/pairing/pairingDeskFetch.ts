/**
 * postPairingJson's fetch over the iroh desk lane: one tunnel per request,
 * the same URL/body/headers the HTTPS desk would receive, and — because any
 * tunnel failure rejects — the same failure mapping postPairingJson already
 * applies (claim_network / complete_network, no new stage). One deadline,
 * armed before the dial, bounds the whole call: the dial races it and the
 * request inherits what is left. The caller's signal (the pairing screen's
 * unmount/back) aborts both phases.
 */

import type { PairingFetch } from "./pairingTransport";
import { fetchJsonOverTunnel } from "../remote/tunnelFetch";
import { openIrohTunnel } from "../remote/irohBridge";
import type { IrohTunnel } from "../remote/irohHttp";

/** One desk ceremony — dial, request, drip — ends at this deadline. */
const DESK_TIMEOUT_MS = 15_000;

/**
 * Dial inside one deadline window. The promise settles on the first of:
 * dial success, dial failure, abort, deadline — and a tunnel that arrives
 * after its window closed is shut down instead of ridden.
 */
function dialDeskTunnel(
  nodeHex: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<IrohTunnel> {
  return new Promise<IrohTunnel>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => settle(() => reject(new Error("aborted")));
    timer = setTimeout(
      () => settle(() => reject(new Error("desk dial deadline exceeded"))),
      Math.max(deadline - Date.now(), 0),
    );
    signal?.addEventListener("abort", onAbort);
    openIrohTunnel(nodeHex, "desk").then(
      (opened) => {
        if (settled) void opened.shutdown();
        else settle(() => resolve(opened));
      },
      (error: unknown) => {
        if (!settled) {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      },
    );
  });
}

/**
 * Build the fetcher for a pairing ceremony dialled to `nodeHex`. The road
 * gate (valid node + native module present) belongs to the caller; this
 * function assumes the road is iroh and lets every failure reject.
 */
export function createDeskPairingFetch(nodeHex: string, signal?: AbortSignal): PairingFetch {
  return async (url, init) => {
    if (signal?.aborted === true) throw new Error("aborted");
    const deadline = Date.now() + DESK_TIMEOUT_MS;
    const tunnel = await dialDeskTunnel(nodeHex, signal, deadline);
    return fetchJsonOverTunnel(tunnel, url, init, {
      timeoutMs: DESK_TIMEOUT_MS,
      // Per-read timeouts reset on every byte: the request gets only the
      // window the dial left of the one ceremony deadline.
      totalTimeoutMs: Math.max(deadline - Date.now(), 0),
      signal,
    });
  };
}
