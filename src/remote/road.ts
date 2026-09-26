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
export type RoadReason = HttpsRoadReason | "connected" | "connect_failed";

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
 * Exactly one KALSA_ROAD line per door operation, always-on like
 * KALSA_PAIRING_FAIL: road, reason, and at most the node's first 8 hex —
 * never a URL, a credential, or the full node id.
 */
export function logRoadDecision(road: Road, reason: RoadReason, node: string | null | undefined): void {
  try {
    const line: Record<string, string> = { road, reason };
    if (isValidNodeHex(node)) line.node8 = node.slice(0, 8);
    console.log("KALSA_ROAD", JSON.stringify(line));
  } catch {
    // Logging must never change the road.
  }
}
