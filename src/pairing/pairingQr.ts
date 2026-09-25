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

// PairingSession.begin() rejects any other shape with its own identical
// regex before the one-shot code is claimed, so scanning it would only
// waste the claim attempt. hexToBytes is lowercase-only ([0-9a-f]*), which
// fixes the nonce (and node) casing rule for the whole wire.
const CODE_PATTERN = /^[0-9a-f]{32}$/;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const NODE_PATTERN = /^[0-9a-f]{64}$/;

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
  if (payload.node === undefined) return { ok: true, square: { reachable, code, nonce, node: "" } };
  const node = payload.node;
  if (typeof node !== "string" || !NODE_PATTERN.test(node)) {
    return { ok: false, error: "invalidNode" };
  }
  return { ok: true, square: { reachable, code, nonce, node } };
}
