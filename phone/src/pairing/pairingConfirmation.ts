/**
 * The phone's half of "Confirm on your computer": with the credential
 * already saved, poll GET /props against the paired door — on the same
 * road rules the chat uses — until the owner allows, one hard deadline,
 * or the screen goes away.
 *
 * Desk vocabulary (kalsa-brain, final contract): 401 = no verdict yet
 * (refused and revoked are also 401 — only the deadline separates them);
 * 403 with an EMPTY body = the listener is out of sockets, try again;
 * ANY other status — 403 with a body included — = allowed.
 */

import { canSendAuthorization, joinRemoteApiUrl, remoteUrlGateError } from "../engine/remote/remoteUrl";
import { doorRequestBase } from "../engine/remote/doorRequestBase";
import type { SavedPairingCredential } from "./pairingRecord";
import { doorFetchFor, establishDoorRoad, type DoorFetch, type DoorRoad } from "../remote/doorRoad";

export type ConfirmationResponse = { status: number; bodyEmpty: boolean };

export type ConfirmationVerdict = "allowed" | "pending" | "retry";

export function confirmationVerdict(response: ConfirmationResponse): ConfirmationVerdict {
  if (response.status === 401) return "pending";
  if (response.status === 403) return response.bodyEmpty ? "retry" : "allowed";
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
  /**
   * One GET /props against the paired door. The signal it receives covers
   * the caller's abort, the poll deadline and the per-probe timeout —
   * aborting it shuts down whichever road's transport is in flight.
   */
  probe: (signal: AbortSignal) => Promise<ConfirmationResponse>;
  signal?: AbortSignal;
  intervalMs: number;
  /** One hard deadline for the whole poll, in-flight probe included. */
  deadlineMs: number;
  /** One probe may hang at most this long before it counts as unreachable. */
  perProbeTimeoutMs: number;
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
 * phase is reported through onPhase, and two clocks bound the loop: every
 * probe gets its own timeout, and the deadline is checked BEFORE any
 * verdict is accepted — a response that lands after it cannot pair the
 * phone. Caller abort ends the poll with "aborted": no outcome for a
 * screen that is gone.
 */
export async function pollForAllowance(options: ConfirmationOptions): Promise<ConfirmationOutcome> {
  if (options.signal?.aborted === true) return { result: "aborted" };
  // One combined abort for everything the probe must stop for; the flags
  // say which reason fired, because they choose different outcomes.
  const pollAbort = new AbortController();
  let callerAborted = false;
  let deadlineFired = false;
  const deadlineTimer = setTimeout(() => {
    deadlineFired = true;
    pollAbort.abort();
  }, options.deadlineMs);
  const onCallerAbort = () => {
    callerAborted = true;
    pollAbort.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort);
  // Read through a call: the aborts flip while the probe is in flight.
  const callerDone = () => callerAborted;
  const deadlineDone = () => deadlineFired;

  const runProbe = async (): Promise<ConfirmationVerdict | "unreachable"> => {
    const probeAbort = new AbortController();
    const onPollAbort = () => probeAbort.abort();
    pollAbort.signal.addEventListener("abort", onPollAbort);
    const probeTimer = setTimeout(() => probeAbort.abort(), options.perProbeTimeoutMs);
    try {
      return confirmationVerdict(await options.probe(probeAbort.signal));
    } catch {
      return "unreachable";
    } finally {
      clearTimeout(probeTimer);
      pollAbort.signal.removeEventListener("abort", onPollAbort);
    }
  };

  let failures = 0;
  options.onPhase?.({ phase: "waiting" });
  try {
    while (true) {
      if (callerDone()) return { result: "aborted" };
      if (deadlineDone()) return { result: "not_confirmed" };
      const verdict = await runProbe();
      // The deadline outranks any verdict: checked before it is accepted.
      if (callerDone()) return { result: "aborted" };
      if (deadlineDone()) return { result: "not_confirmed" };
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
      await sleep(options.intervalMs, pollAbort.signal);
    }
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * The probe itself: one GET /props with the new credential on the paired
 * door's road. The road is established once and reused; a failed
 * establishment is retried on the next tick (its KALSA_ROAD line is the
 * door road's contract, one per attempt). The DoorFetch closure is built
 * exactly once per poll: a fresh one would restart from the road's
 * already-consumed firstTunnel, replaying a closed tunnel every tick.
 */
export function pairedPropsProbe(
  paired: SavedPairingCredential,
): (signal?: AbortSignal) => Promise<ConfirmationResponse> {
  let road: DoorRoad | null = null;
  let fetcher: DoorFetch | null = null;
  return async (signal) => {
    // The same pre-request verdicts the three door paths run: the base is
    // the saved address or the shared iroh verdict — never the stand-in
    // named by hand — and the URL gate runs on whichever base resulted.
    // Re-read per tick: the iroh road can come back between ticks.
    const resolved = doorRequestBase({
      url: paired.doorUrl,
      node: paired.node,
      pairedVia: paired.pairedVia,
      source: "pairing",
    });
    if (!resolved.ok) throw new Error(resolved.error);
    const gate = remoteUrlGateError(resolved.base);
    if (gate !== null) throw new Error(gate);
    if (road === null || fetcher === null) {
      road = await establishDoorRoad(paired, signal);
      fetcher = doorFetchFor(road);
    }
    const url = joinRemoteApiUrl(resolved.base, "/props");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (canSendAuthorization(url)) headers.Authorization = `Bearer ${paired.credential}`;
    const response = await fetcher(url, { method: "GET", headers, signal });
    return {
      status: response.status,
      // Only the 403 case needs the body, and only it may read it.
      bodyEmpty: response.status === 403 ? await response.isBodyEmpty() : false,
    };
  };
}
