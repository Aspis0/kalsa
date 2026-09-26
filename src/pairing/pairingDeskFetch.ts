/**
 * postPairingJson's fetch over the iroh desk lane: one tunnel per request,
 * the same URL/body/headers the HTTPS desk would receive, and — because any
 * tunnel failure rejects — the same failure mapping postPairingJson already
 * applies (claim_network / complete_network, no new stage).
 */

import type { PairingFetch } from "./pairingTransport";
import { fetchJsonOverTunnel } from "../remote/tunnelFetch";
import { openIrohTunnel } from "../remote/irohBridge";

/** Desk reads are local-control-plane fast; a slow desk is a refused desk. */
const DESK_TIMEOUT_MS = 15_000;

/**
 * Build the fetcher for a pairing ceremony dialled to `nodeHex`. The road
 * gate (valid node + native module present) belongs to the caller; this
 * function assumes the road is iroh and lets every failure reject.
 */
export function createDeskPairingFetch(nodeHex: string): PairingFetch {
  return async (url, init) =>
    fetchJsonOverTunnel(await openIrohTunnel(nodeHex, "desk"), url, init, {
      timeoutMs: DESK_TIMEOUT_MS,
    });
}
