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
 * Dial `nodeHex` on `lane`; the returned tunnel owns one remote connection
 * and is closed by `shutdown()` (idempotent). Every failure — no module,
 * no bridge, unreachable desktop — rejects, and the caller decides what a
 * rejection means for its road.
 */
export async function openIrohTunnel(nodeHex: string, lane: IrohLane): Promise<IrohTunnel> {
  const module = loadModule();
  if (module === null) throw new Error("iroh module unavailable");
  await ensureStarted(module);
  const id = await module.openTunnel(nodeHex, lane);
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
