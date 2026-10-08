/**
 * The road choice, shared by the pairing desk and the door: iroh only when
 * a valid paired node id exists AND the native module answers at runtime;
 * everything else is the existing HTTPS road. Pure — the module presence
 * arrives as a thunk so a credential without a node never loads anything.
 */

/** The two roads an operation can ride. */
export type Road = "iroh" | "https";

/** Reasons an operation rides HTTPS instead of iroh. */
export type HttpsRoadReason = "no_node" | "module_absent";

/** Why the last road decision went the way it did, for the one log line. */
export type RoadReason = HttpsRoadReason;

export type DialLane = "desk" | "door";
export type IrohDialReason =
  | "ok"
  | "deadline"
  | "aborted"
  | "no_module"
  | "linkage"
  | "invalid_node"
  | "transport"
  | "io"
  | "entropy"
  | "key_corrupt"
  | "config"
  | "closed"
  | "async_context"
  | "other";

export type IrohBridgeStage = "start" | "background_stop" | "idle_stop";
export type IrohBridgeReason = "started" | "stopped" | "tunnels_open" | "error" | "stop_timeout";

export const IROH_DIAL_ERROR_REASONS = {
  KALSA_IROH_DEADLINE: "deadline",
  KALSA_IROH_ABORTED: "aborted",
  KALSA_IROH_NO_MODULE: "no_module",
  KALSA_IROH_LINKAGE: "linkage",
  KALSA_IROH_INVALID_NODE_HEX: "invalid_node",
  KALSA_IROH_TRANSPORT: "transport",
  KALSA_IROH_IO: "io",
  KALSA_IROH_ENTROPY: "entropy",
  KALSA_IROH_KEY_CORRUPT: "key_corrupt",
  KALSA_IROH_CONFIG: "config",
  KALSA_IROH_CLOSED: "closed",
  KALSA_IROH_ASYNC_CONTEXT: "async_context",
  KALSA_IROH_OTHER: "other",
} as const satisfies Record<string, IrohDialReason>;

export type RoadChoice =
  | { road: "https"; reason: HttpsRoadReason }
  // An iroh choice is provisional until the dial completes, so it carries the
  // node to dial and no reason; the dial outcome names the final reason.
  | { road: "iroh"; node: string };

const NODE_PATTERN = /^[0-9a-f]{64}$/;

/** A desktop node id: 64 lowercase hex characters, the QR v3 spelling. */
export function isValidNodeHex(node: unknown): node is string {
  return typeof node === "string" && NODE_PATTERN.test(node);
}

/**
 * Choose the road for one operation. `isModulePresent` runs only when the
 * node is valid, so an HTTPS-only install never touches the native module.
 */
export function chooseRoad(
  node: string | null | undefined,
  isModulePresent: () => boolean,
): RoadChoice {
  if (!isValidNodeHex(node)) return { road: "https", reason: "no_node" };
  if (!isModulePresent()) return { road: "https", reason: "module_absent" };
  return { road: "iroh", node };
}

/**
 * Record a road choice that does not attempt an iroh dial.
 */
export function logRoadDecision(road: Road, reason: RoadReason, node: string | null | undefined): void {
  const line: Record<string, string> = { road, reason };
  if (isValidNodeHex(node)) line.node8 = node.slice(0, 8);
  emitRoadLine(line);
}

/** Map only the native rejection code; its message may contain private details. */
export function irohDialReason(error: unknown): Exclude<IrohDialReason, "ok"> {
  if (!error || typeof error !== "object") return "other";
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(IROH_DIAL_ERROR_REASONS, code)) {
    return "other";
  }
  return IROH_DIAL_ERROR_REASONS[code as keyof typeof IROH_DIAL_ERROR_REASONS];
}

/** One privacy-safe timing line for each native tunnel dial attempt. */
export function logIrohDial(
  lane: DialLane,
  node: string,
  reason: IrohDialReason,
  elapsedMs: number,
): void {
  try {
    const line: Record<string, string | number> = {
      road: "iroh",
      lane,
      stage: "dial",
      reason,
      ms: Math.max(0, Math.round(elapsedMs)),
    };
    if (isValidNodeHex(node)) line.node8 = node.slice(0, 8);
    emitRoadLine(line);
  } catch {
    // Invalid input must never change the dial result.
  }
}

/** Privacy-safe lifecycle decision for lazy bridge start, background and idle stops. */
export function logIrohBridgeDecision(
  stage: IrohBridgeStage,
  reason: IrohBridgeReason,
): void {
  try {
    emitRoadLine({ road: "iroh", stage, reason });
  } catch {
    // Logging must never change bridge lifecycle behavior.
  }
}

function emitRoadLine(line: Record<string, string | number>): void {
  try {
    console.log("KALSA_ROAD", JSON.stringify(line));
  } catch {
    // Logging must never change a road decision.
  }
}
