/**
 * The phone's half of "Confirm on your computer": with the credential
 * already saved, poll GET /props against the paired door — on the same
 * road rules the chat uses — until the owner allows, the cap ends it, or
 * the screen goes away.
 *
 * Desk vocabulary (kalsa-brain, authoritative): 401 = no verdict yet
 * (refused and revoked are also 401 — only the cap separates them);
 * 403 with an EMPTY body = the listener is out of sockets, try again;
 * any other status = allowed. A 403 WITH a body matches none of those
 * signals and is not this door's 401 either, so the poll treats it as
 * unattributable: it keeps waiting rather than claiming a pairing it
 * cannot prove.
 */

import { canSendAuthorization, joinRemoteApiUrl } from "../engine/remote/remoteUrl";
import type { SavedPairingCredential } from "./pairingCredentialStore";
import { doorFetchFor, establishDoorRoad, type DoorRoad } from "../remote/doorRoad";

export type ConfirmationResponse = { status: number; bodyEmpty: boolean };

export type ConfirmationVerdict = "allowed" | "pending" | "retry" | "unattributed";

export function confirmationVerdict(response: ConfirmationResponse): ConfirmationVerdict {
  if (response.status === 401) return "pending";
  if (response.status === 403) return response.bodyEmpty ? "retry" : "unattributed";
  return "allowed";
}

export type ConfirmationPhase =
  | { phase: "waiting" }
  | { phase: "unreachable"; failures: number };

export type ConfirmationOutcome =
  | { result: "paired" }
  | { result: "not_confirmed" }
  | { result: "aborted" };

export type ConfirmationOptions = {
  /** One GET /props against the paired door; rejects on transport errors. */
  probe: () => Promise<ConfirmationResponse>;
  signal?: AbortSignal;
  intervalMs: number;
  capMs: number;
  /** Consecutive transport failures before the unreachable line shows. */
  unreachableAfter: number;
  onPhase?: (phase: ConfirmationPhase) => void;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

/**
 * Probe until allowed or out of time. The first probe is immediate, each
 * phase is reported through onPhase (the screen shows/clears its lines
 * from there), and an aborted signal ends the poll with "aborted" — no
 * outcome for a screen that is gone.
 */
export async function pollForAllowance(options: ConfirmationOptions): Promise<ConfirmationOutcome> {
  const startedAt = Date.now();
  // Read through a call: the abort flips while the probe is in flight.
  const aborted = () => options.signal?.aborted === true;
  let failures = 0;
  options.onPhase?.({ phase: "waiting" });
  while (true) {
    if (aborted()) return { result: "aborted" };
    let verdict: ConfirmationVerdict | "unreachable";
    try {
      verdict = confirmationVerdict(await options.probe());
    } catch {
      verdict = "unreachable";
    }
    if (aborted()) return { result: "aborted" };
    if (verdict === "allowed") return { result: "paired" };
    if (verdict === "unreachable") {
      failures += 1;
      if (failures >= options.unreachableAfter) {
        options.onPhase?.({ phase: "unreachable", failures });
      }
    } else {
      failures = 0;
      options.onPhase?.({ phase: "waiting" });
    }
    if (Date.now() - startedAt >= options.capMs) return { result: "not_confirmed" };
    await sleep(options.intervalMs, options.signal);
  }
}

/**
 * The probe itself: one GET /props with the new credential on the paired
 * door's road. The road is established once and reused; a failed
 * establishment is retried on the next tick (its KALSA_ROAD line is the
 * door road's contract, one per attempt).
 */
export function pairedPropsProbe(
  paired: SavedPairingCredential,
  signal?: AbortSignal,
): () => Promise<ConfirmationResponse> {
  let road: DoorRoad | null = null;
  return async () => {
    road ??= await establishDoorRoad(paired, signal);
    const url = joinRemoteApiUrl(paired.doorUrl, "/props");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (canSendAuthorization(url)) headers.Authorization = `Bearer ${paired.credential}`;
    const response = await doorFetchFor(road)(url, { method: "GET", headers, signal });
    return {
      status: response.status,
      // Only the 403 case needs the body, and only it may read it.
      bodyEmpty: response.status === 403 ? await response.isBodyEmpty() : false,
    };
  };
}
