export type PairingFailStage =
  | "random"
  | "validate"
  | "claim_url"
  | "claim_network"
  | "claim_status"
  | "complete_network"
  | "complete_status"
  | "seal"
  | "save"
  | "request_too_large"
  | "unexpected";

/**
 * One always-on line per failed pairing attempt. logcat must answer "which
 * step failed" with no diagnostics switch on, so the record carries only the
 * stage and the HTTP status: never a code, nonce, MAC, token, credential or
 * URL.
 */
export function logPairingFail(stage: PairingFailStage, status: number | null): void {
  try {
    console.log("KALSA_PAIRING_FAIL", JSON.stringify({ stage, status }));
  } catch {
    // Logging must never change the pairing outcome.
  }
}
