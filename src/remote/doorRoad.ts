/**
 * The door road for one operation (a probe or one chat turn): chosen from
 * the paired credential's node plus the runtime module, established with
 * exactly one connect whose tunnel carries the operation's first request,
 * and recorded as exactly one KALSA_ROAD line. Rule: the road may fall
 * from iroh to the paired HTTPS URL only when that first connect fails —
 * before any request byte left the phone — never mid-request.
 */

import { chooseRoad, logRoadDecision } from "./road";
import { irohModulePresent, openIrohTunnel } from "./irohBridge";
import { fetchJsonOverTunnel, type TunnelJsonResponse } from "./tunnelFetch";
import type { IrohTunnel } from "./irohHttp";

/** Probe reads answer inside the probe's own 10 s abort window. */
const PROBE_JSON_TIMEOUT_MS = 8_000;

export type DoorRoad =
  | { road: "https" }
  | {
      road: "iroh";
      node: string;
      /** The establishment connect; the operation's first request rides it. */
      firstTunnel: IrohTunnel;
      /** A fresh door tunnel for a later request of the same operation. */
      openTunnel: () => Promise<IrohTunnel>;
    };

/**
 * Decide and establish the road. Never rejects: a failed iroh connect is
 * the HTTPS road plus its one log line, because the fallback target is the
 * same paired desktop the iroh dial was aiming at.
 */
export async function establishDoorRoad(
  node: string | null | undefined,
): Promise<DoorRoad> {
  const choice = chooseRoad(node, irohModulePresent);
  if (choice.road === "https") {
    logRoadDecision("https", choice.reason, node);
    return { road: "https" };
  }
  try {
    const firstTunnel = await openIrohTunnel(choice.node, "door");
    logRoadDecision("iroh", "connected", choice.node);
    return {
      road: "iroh",
      node: choice.node,
      firstTunnel,
      openTunnel: () => openIrohTunnel(choice.node, "door"),
    };
  } catch {
    logRoadDecision("https", "connect_failed", choice.node);
    return { road: "https" };
  }
}

export type DoorFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<TunnelJsonResponse>;

/**
 * The fetch a probe runs its GETs on: global fetch on the HTTPS road; on
 * the iroh road the establishment tunnel carries the first request and
 * every later one opens its own. A later connect failing fails that
 * request — the operation does not change roads halfway.
 */
export function doorFetchFor(road: DoorRoad): DoorFetch {
  if (road.road === "https") return globalThis.fetch;
  let pending: IrohTunnel | null = road.firstTunnel;
  return async (url, init) => {
    const tunnel = pending ?? (await road.openTunnel());
    pending = null;
    return fetchJsonOverTunnel(tunnel, url, init, {
      timeoutMs: PROBE_JSON_TIMEOUT_MS,
      signal: init.signal,
    });
  };
}
