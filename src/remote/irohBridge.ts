/**
 * The native iroh module from JS: required on first use (never at import
 * time — a CI APK without the Rust .so must read as "no iroh road"), and
 * turned into IrohTunnels, the byte shape src/remote/irohHttp speaks.
 * Base64 is only the seam to the native module; tunnel users see bytes.
 */

import type { IrohLane } from "../../modules/kalsa-iroh/src/index";
import type { IrohTunnel } from "./irohHttp";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../util/base64";
import { irohDialReason, logIrohBridgeDecision, logIrohDial } from "./road";
import { notifyIrohDial, notifyIrohTunnelClosed } from "./irohBackgroundStop";

type IrohModule = typeof import("../../modules/kalsa-iroh/src/index");

function loadModule(): IrohModule | null {
  try {
    // require() memoizes on success, so this is cheap after the first
    // call; a FAILED require must not be remembered — the module may
    // answer on the next call (late unpack, hot reload), and this
    // predicate decides whether the iroh road exists at all.
    return require("../../modules/kalsa-iroh/src/index") as IrohModule;
  } catch {
    // Unloadable right now: the HTTPS road for this call, retryable.
    return null;
  }
}

/** Whether the iroh road exists on this install at all. */
export function irohModulePresent(): boolean {
  try {
    return loadModule()?.isNativeModulePresent() ?? false;
  } catch {
    return false;
  }
}

let started: Promise<void> | null = null;
let stopping: Promise<boolean> | null = null;
const STOP_WAIT_TIMEOUT_MS = 3_000;

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(dialError("KALSA_IROH_ABORTED", "dial aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(dialError("KALSA_IROH_ABORTED", "dial aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function waitForStopOrTimeout(promise: Promise<boolean>): Promise<"settled" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), STOP_WAIT_TIMEOUT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve("settled");
      },
      () => {
        clearTimeout(timer);
        resolve("settled");
      },
    );
  });
}

async function ensureStarted(module: IrohModule, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw dialError("KALSA_IROH_ABORTED", "dial aborted");
  if (stopping !== null) {
    const stopInFlight = stopping;
    const outcome = await waitForSignal(waitForStopOrTimeout(stopInFlight), signal);
    if (outcome === "timeout") {
      logIrohBridgeDecision("start", "stop_timeout");
      // The native operation may still be queued or running. Do not let its
      // pending promise hold this dial open forever; openTunnel will report
      // whether the existing bridge is still usable.
      return;
    }
    return ensureStarted(module, signal);
  }
  if (started === null) {
    // Native startBridge replaces a running bridge and drops its tunnels.
    // Keep this promise until native stopBridge confirms the bridge is down.
    started = module.startBridge().then(
      () => logIrohBridgeDecision("start", "started"),
      (error: unknown) => {
        started = null;
        logIrohBridgeDecision("start", "error");
        throw error;
      },
    );
  }
  return waitForSignal(started, signal);
}

/** Stop after the current start settles; a later dial restarts lazily. */
export function stopIrohBridge(): Promise<boolean> {
  if (stopping !== null) return stopping;
  const pendingStart = started;
  stopping = (async () => {
    if (pendingStart !== null) await pendingStart;
    const module = loadModule();
    if (module === null) {
      return false;
    }
    const stopped = await module.stopBridge();
    if (stopped) started = null;
    return stopped;
  })().finally(() => {
    stopping = null;
  });
  return stopping;
}

function dialError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * The native dial has no deadline of its own: race it against the caller's
 * signal — which carries the confirmation poll's deadline, its per-probe
 * timeout and the screen's abort. Settle-once: an aborted dial rejects at
 * once, and a handle the native side lands after that is shut down, never
 * handed out.
 */
function raceDial(
  dial: () => Promise<number>,
  signal: AbortSignal | undefined,
  module: IrohModule,
): Promise<number> {
  if (signal === undefined) return dial();
  if (signal.aborted === true) {
    return Promise.reject(dialError("KALSA_IROH_ABORTED", "dial aborted"));
  }
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(dialError("KALSA_IROH_ABORTED", "dial aborted"));
    };
    signal.addEventListener("abort", onAbort);
    dial().then(
      (id) => {
        if (settled) {
          void Promise.resolve(module.tunnelShutdown(id)).then(
            notifyIrohTunnelClosed,
            notifyIrohTunnelClosed,
          );
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(id);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Dial `nodeHex` on `lane`; the returned tunnel owns one remote connection
 * and is closed by `shutdown()` (idempotent). Every failure — no module,
 * no bridge, unreachable desktop — rejects, and the caller decides what a
 * rejection means for its road. `signal` races the dial as described above.
 */
export async function openIrohTunnel(
  nodeHex: string,
  lane: IrohLane,
  signal?: AbortSignal,
): Promise<IrohTunnel> {
  const startedAt = Date.now();
  try {
    const module = loadModule();
    if (module === null) {
      throw dialError("KALSA_IROH_NO_MODULE", "iroh module unavailable");
    }
    // Reset the idle clock first: a stop that already fired serializes
    // inside ensureStarted instead of racing this dial.
    notifyIrohDial();
    await ensureStarted(module, signal);
    const id = await raceDial(() => module.openTunnel(nodeHex, lane), signal, module);
    logIrohDial(lane, nodeHex, "ok", Date.now() - startedAt);
    let closed = false;
    return {
      write: (bytes, timeoutMs) => module.tunnelWrite(id, uint8ArrayToBase64(bytes), timeoutMs),
      read: async (max, timeoutMs) =>
        base64ToUint8Array(await module.tunnelRead(id, max, timeoutMs)),
      shutdown: async () => {
        if (closed) return;
        closed = true;
        try {
          await module.tunnelShutdown(id);
        } finally {
          notifyIrohTunnelClosed();
        }
      },
    };
  } catch (error) {
    logIrohDial(
      lane,
      nodeHex,
      signal?.aborted === true ? "aborted" : irohDialReason(error),
      Date.now() - startedAt,
    );
    throw error;
  }
}
