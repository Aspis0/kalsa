import type { PairingSquare } from "./pairingTransport";

export type PairingQrErrorCode =
  | "notJson"
  | "notObject"
  | "missingField"
  | "unsupportedVersion"
  | "invalidCode"
  | "invalidNonce"
  | "invalidNode";

export type PairingQrResult =
  | { ok: true; square: PairingSquare }
  | { ok: false; error: PairingQrErrorCode };

// What the transport already enforces, mirrored so a bad square is refused
// at scan time instead of inside the ceremony: PairingSession.begin() tests
// the code against ^[0-9a-f]{32}$ and decodes the nonce with hexToBytes
// (lowercase-only) plus its 32-byte length check before the claim. The node
// is normalised to lowercase here — its canonical spelling — and re-checked
// later by the road gate and the credential store.
const CODE_PATTERN = /^[0-9a-f]{32}$/;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const NODE_PATTERN = /^[0-9a-f]{64}$/;
const TAILNET_PREFIX = "https://";
/** The tailnet host, exactly: lowercase, no port/path/query/fragment. */
const TAILNET_HOST_PATTERN = /^[a-z0-9.-]+$/;

/**
 * The optional v3 `tailnet`: a validated `https://<host>` (lowercase
 * [a-z0-9.-], 1..100 chars, no leading/trailing dot), else "" — a
 * malformed value is the absence of a value, never a refused scan. It is
 * never MAC'd: the signatures cover reachable/node exactly as before.
 */
function canonicalTailnet(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith(TAILNET_PREFIX)) return "";
  const host = value.slice(TAILNET_PREFIX.length);
  if (host.length < 1 || host.length > 100) return "";
  if (!TAILNET_HOST_PATTERN.test(host)) return "";
  if (host.startsWith(".") || host.endsWith(".")) return "";
  return value;
}

const REQUIRED_STRING_FIELDS = ["reachable", "code", "nonce"] as const;

/**
 * Parse the desktop's v3 pairing square (one QR = one JSON object) into the
 * fields the manual form fills. Unknown top-level keys are tolerated on
 * purpose: the wire's only other JSON acceptance path, the seal check in
 * pairingTransport, requires its known fields and ignores the rest, and
 * compatibility is gated by `v` alone.
 */
export function parsePairingQr(text: string): PairingQrResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "notObject" };
  }
  const payload = value as Record<string, unknown>;
  // The desktop's version gate: a `v` this build does not speak refuses the
  // whole document instead of guessing at its fields.
  if (payload.v !== 3) {
    return { ok: false, error: payload.v === undefined ? "missingField" : "unsupportedVersion" };
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof payload[field] !== "string") return { ok: false, error: "missingField" };
  }
  const reachable = payload.reachable as string;
  const code = payload.code as string;
  const nonce = payload.nonce as string;
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "invalidCode" };
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, error: "invalidNonce" };
  // `reachable` is MAC'd exactly as shown and never dialled by the phone:
  // no URL validation, no trimming, no normalisation of any kind here.
  const tailnet = canonicalTailnet(payload.tailnet);
  if (payload.node === undefined) {
    return { ok: true, square: { reachable, code, nonce, node: "", tailnet } };
  }
  const node = payload.node;
  if (typeof node !== "string") return { ok: false, error: "invalidNode" };
  // Uppercase hex is the same key: accept it and store the canonical
  // lowercase form the road gate and the credential store require.
  const canonicalNode = node.toLowerCase();
  if (!NODE_PATTERN.test(canonicalNode)) {
    return { ok: false, error: "invalidNode" };
  }
  return { ok: true, square: { reachable, code, nonce, node: canonicalNode, tailnet } };
}
