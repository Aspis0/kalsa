/**
 * postPairingJson's fetch over the iroh desk lane: one tunnel per request,
 * the same URL/body/headers the HTTPS desk would receive, and — because any
 * tunnel failure rejects — the same failure mapping postPairingJson already
 * applies (claim_network / complete_network, no new stage). The caller's
 * signal (the pairing screen's unmount/back) aborts before the dial and
 * shuts the tunnel during a request.
 */

import type { PairingFetch } from "./pairingTransport";
import { fetchJsonOverTunnel } from "../remote/tunnelFetch";
import { openIrohTunnel } from "../remote/irohBridge";

/** One desk ceremony, dial or drip included, is bounded by this deadline. */
const DESK_TIMEOUT_MS = 15_000;

/**
 * Build the fetcher for a pairing ceremony dialled to `nodeHex`. The road
 * gate (valid node + native module present) belongs to the caller; this
 * function assumes the road is iroh and lets every failure reject.
 */
export function createDeskPairingFetch(nodeHex: string, signal?: AbortSignal): PairingFetch {
  return async (url, init) => {
    if (signal?.aborted === true) throw new Error("aborted");
    const tunnel = await openIrohTunnel(nodeHex, "desk");
    return fetchJsonOverTunnel(tunnel, url, init, {
      timeoutMs: DESK_TIMEOUT_MS,
      // Per-read timeouts reset on every byte; the whole request — dial
      // outcome aside — must still finish inside one deadline.
      totalTimeoutMs: DESK_TIMEOUT_MS,
      signal,
    });
  };
}
