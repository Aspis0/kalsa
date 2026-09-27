/**
 * The native iroh module from JS: required on first use (never at import
 * time — a CI APK without the Rust .so must read as "no iroh road"), and
 * turned into IrohTunnels, the byte shape src/remote/irohHttp speaks.
 * Base64 is only the seam to the native module; tunnel users see bytes.
 */

import type { IrohLane } from "../../modules/kalsa-iroh/src/index";
import type { IrohTunnel } from "./irohHttp";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../util/base64";

type IrohModule = typeof import("../../modules/kalsa-iroh/src/index");

let cached: IrohModule | null | undefined;

function loadModule(): IrohModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = require("../../modules/kalsa-iroh/src/index") as IrohModule;
  } catch {
    // Unresolvable or unloadable module: the HTTPS road, remembered.
    cached = null;
  }
  return cached;
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

function ensureStarted(module: IrohModule): Promise<void> {
  if (started === null) {
    // startBridge REPLACES any running native bridge and drops it — closing
    // the tunnels it opened — so it runs exactly once per session; only a
    // failed start is retryable.
    started = module.startBridge().catch((error: unknown) => {
      started = null;
      throw error;
    });
  }
  return started;
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
  if (signal.aborted === true) return Promise.reject(new Error("dial aborted"));
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new Error("dial aborted"));
    };
    signal.addEventListener("abort", onAbort);
    dial().then(
      (id) => {
        if (settled) {
          void module.tunnelShutdown(id);
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
  const module = loadModule();
  if (module === null) throw new Error("iroh module unavailable");
  await ensureStarted(module);
  const id = await raceDial(() => module.openTunnel(nodeHex, lane), signal, module);
  let closed = false;
  return {
    write: (bytes, timeoutMs) => module.tunnelWrite(id, uint8ArrayToBase64(bytes), timeoutMs),
    read: async (max, timeoutMs) =>
      base64ToUint8Array(await module.tunnelRead(id, max, timeoutMs)),
    shutdown: async () => {
      if (closed) return;
      closed = true;
      await module.tunnelShutdown(id);
    },
  };
}
