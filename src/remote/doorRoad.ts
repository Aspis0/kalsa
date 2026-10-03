/**
 * The door road for one operation (a probe or one chat turn): chosen from
 * the paired credential's node plus the runtime module, established with
 * one connect whose tunnel carries the operation's first request. Every
 * native dial records its own KALSA_ROAD timing line in `irohBridge.ts`.
 *
 * Fallback rule: HTTPS is a road only for a credential whose PAIRING went
 * over HTTPS to the saved URLs (pairedVia "https") — that ceremony proved
 * the URL answers for the paired desktop. A credential paired over iroh —
 * or one whose pairing road is unknown — never falls back: a failed
 * connect is a connection error, surfaced like any unreachable desk.
 */

import {
  chooseRoad,
  isValidNodeHex,
  logRoadDecision,
  type Road,
  type RoadChoice,
} from "./road";
import { irohModulePresent, openIrohTunnel } from "./irohBridge";
import { fetchJsonOverTunnel, type TunnelJsonResponse } from "./tunnelFetch";
import { IROH_TUNNEL_URL } from "../pairing/pairingUrls";
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
      /** A fresh door tunnel for a later request of the same operation; the
       *  signal races its native dial (which has no deadline of its own). */
      openTunnel: (signal?: AbortSignal) => Promise<IrohTunnel>;
    };

/** The pairing facts a road decision needs; RemoteDoorConfig satisfies it. */
export type PairedDoor = { node: string | null; pairedVia: Road | null };

/**
 * The one iroh verdict for a paired door: iroh only when the pairing
 * itself rode iroh — a "https" pairing may still fall back to its proven
 * URL once a dial fails, and a record whose pairing road is unknown is
 * never trusted with the doorless stand-in — and the road still exists
 * (valid node, module present). `establishDoorRoad` sends exactly these
 * records to iroh-or-error, never to the network, so `doorRequestBase`
 * naming the stand-in origin for them cannot disagree with the road a
 * request actually rides.
 */
export function pairedIrohRoad(door: PairedDoor): Extract<RoadChoice, { road: "iroh" }> | null {
  if (door.pairedVia !== "iroh") return null;
  const choice = chooseRoad(door.node, irohModulePresent);
  return choice.road === "iroh" ? choice : null;
}

/** What an unreachable desk already reports: mapped to copy, never shown raw. */
function connectionError(): Error {
  return new Error("remote_brain_network");
}

/** The turn/probe died while dialling: the code the UI already knows. */
function abortedError(): Error {
  const error = new Error("remote_brain_aborted") as Error & { code: string };
  error.code = "interrupted";
  return error;
}

/**
 * Decide and establish the road. Rejects only when there is no road to
 * ride (an iroh-paired credential whose dial or module is gone) or the
 * caller's signal aborted the operation — never as a fallback trigger.
 */
export async function establishDoorRoad(
  door: PairedDoor,
  signal?: AbortSignal,
): Promise<DoorRoad> {
  // Read through a call: the abort can flip between the checks, and TS's
  // narrowing of `signal?.aborted` would otherwise make the second read dead.
  const aborted = () => signal?.aborted === true;
  if (aborted()) throw abortedError();
  // The shared verdict: the iroh records here are the ones
  // `doorRequestBase` names the stand-in origin for — they ride iroh or
  // fail (their pairing proved no network URL to fall back to); the
  // fallback below exists only for the others.
  const choice = pairedIrohRoad(door) ?? chooseRoad(door.node, irohModulePresent);
  if (choice.road === "https") {
    if (isValidNodeHex(door.node) && door.pairedVia !== "https") {
      // A node whose pairing never proved the saved URL, and no iroh road
      // to reach it: HTTPS here would send the bearer to an unproven host.
      logRoadDecision("iroh", "module_absent", door.node);
      throw connectionError();
    }
    logRoadDecision("https", choice.reason, door.node);
    return { road: "https" };
  }
  let firstTunnel: IrohTunnel;
  // The signalless dial stays a two-argument call: the native race only
  // exists when there is something to race against.
  const dialDoor = (signal?: AbortSignal) =>
    signal === undefined
      ? openIrohTunnel(choice.node, "door")
      : openIrohTunnel(choice.node, "door", signal);
  try {
    firstTunnel = await dialDoor(signal);
  } catch {
    // An aborted dial is the operation ending, not a road verdict: no
    // KALSA_ROAD line, no fallback decision.
    if (aborted()) throw abortedError();
    if (door.pairedVia === "https") {
      return { road: "https" };
    }
    throw connectionError();
  }
  if (aborted()) {
    // The operation died while dialling: close before any request could ride it.
    await firstTunnel.shutdown();
    throw abortedError();
  }
  return {
    road: "iroh",
    node: choice.node,
    firstTunnel,
    openTunnel: (signal) => dialDoor(signal),
  };
}

export type DoorFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    /** JSON body; the tunnel recomputes Content-Length and never forwards one. */
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<TunnelJsonResponse>;

/** True for the iroh stand-in origin, whatever path follows it. */
function isIrohStandInUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(IROH_TUNNEL_URL).host;
  } catch {
    return false;
  }
}

/**
 * The fetch a probe runs its GETs on: global fetch on the HTTPS road; on
 * the iroh road the establishment tunnel carries the first request and
 * every later one opens its own. A later connect failing fails that
 * request — the operation does not change roads halfway.
 */
export function doorFetchFor(road: DoorRoad): DoorFetch {
  if (road.road === "https") {
    // Wrapped only to carry the same shape as the tunnel road: json() stays
    // the response's own, and the body is read only when someone asks
    // whether it was empty (the confirmation poll, on a 403).
    return async (url, init) => {
      // Defence in depth: the stand-in origin names a request line on the
      // tunnel, never a network destination — it is refused here before
      // any socket, so it cannot reach one with a bearer whatever a
      // caller computes as the base.
      if (isIrohStandInUrl(url)) throw new Error("remote_brain_iroh_missing");
      const res = await globalThis.fetch(url, init);
      return {
        ok: res.ok,
        status: res.status,
        isBodyEmpty: async () => (await res.text()).length === 0,
        json: () => res.json(),
      };
    };
  }
  let pending: IrohTunnel | null = road.firstTunnel;
  return async (url, init) => {
    const tunnel = pending ?? (await road.openTunnel(init.signal));
    pending = null;
    return fetchJsonOverTunnel(tunnel, url, init, {
      timeoutMs: PROBE_JSON_TIMEOUT_MS,
      signal: init.signal,
    });
  };
}
