/**
 * JS face of the iroh road (Android). One bridge holds the node identity;
 * tunnels are numbered handles whose byte moves are base64 at this seam.
 * All calls are async: natively they block on plain threads bounded by
 * per-call deadlines, and the JS thread must never be one of them.
 */

import { requireOptionalNativeModule } from "expo-modules-core";

/** The desktop's two loopback services; rides the tunnel's ALPN. */
export type IrohLane = "door" | "desk";

type NativeKalsaIrohModule = {
  startBridge(): Promise<void>;
  nodeId(): Promise<string>;
  openTunnel(nodeHex: string, lane: IrohLane): Promise<number>;
  write(id: number, base64: string, timeoutMs: number): Promise<void>;
  read(id: number, max: number, timeoutMs: number): Promise<string>;
  shutdown(id: number): Promise<void>;
};

let nativeModule: NativeKalsaIrohModule | null | undefined;

function getNativeModule(): NativeKalsaIrohModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule =
      requireOptionalNativeModule<NativeKalsaIrohModule>("KalsaIroh") ?? null;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

function requireModule(): NativeKalsaIrohModule {
  const module = getNativeModule();
  if (!module) {
    throw new Error("KalsaIroh native module unavailable (Android only)");
  }
  return module;
}

/**
 * Load or mint the node identity. The key file's path is resolved natively
 * from the app's filesDir (`<filesDir>/iroh-node.key`, owner-only); no
 * path crosses the JS bridge.
 */
export function startBridge(): Promise<void> {
  return requireModule().startBridge();
}

/** This node's public identity, 64 hex characters. */
export function nodeId(): Promise<string> {
  return requireModule().nodeId();
}

/** Dial the desktop by its 64-hex node id; resolves to a tunnel handle. */
export function openTunnel(nodeHex: string, lane: IrohLane): Promise<number> {
  return requireModule().openTunnel(nodeHex, lane);
}

/** Write bytes (base64) under the caller's deadline; a timeout closes the tunnel. */
export function tunnelWrite(
  id: number,
  base64: string,
  timeoutMs: number,
): Promise<void> {
  return requireModule().write(id, base64, timeoutMs);
}

/** Read up to `max` bytes as base64; an empty string is EOF. */
export function tunnelRead(
  id: number,
  max: number,
  timeoutMs: number,
): Promise<string> {
  return requireModule().read(id, max, timeoutMs);
}

/** Half-close the tunnel and release its handle. */
export function tunnelShutdown(id: number): Promise<void> {
  return requireModule().shutdown(id);
}
