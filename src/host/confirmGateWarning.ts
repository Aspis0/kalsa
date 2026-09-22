/**
 * The confirm sheet's low-memory sentence — the one place the pre-download
 * verdict speaks in NUMBERS: what loading this model will charge against what
 * the phone has free right now, and what downloading anyway will and will not
 * buy. Pure: verdict + the sample it was priced against in, sentence (or
 * null) out, so both catalogues and the byte maths are testable without a
 * device — the gate itself sits behind `llama.rn` and is not importable here.
 */
import type { ModelGateVerdict } from "../engine/deviceProfile";
import type { TranslateFn } from "../i18n";

const BYTES_PER_MB = 1_000_000;
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Narrow view of the verdict this sentence reads: `gateForModel`'s own shape,
 * structurally (no runtime import of the heavy gate module).
 */
type WarningVerdict = {
  allowed: boolean;
  reason: ModelGateVerdict["reason"];
  nonEvictableMiB: number | null;
};

export function confirmGateWarning(args: {
  gate: WarningVerdict;
  availableMemoryBytes: number | null;
  modelName: string;
  t: TranslateFn;
}): string | null {
  const { gate, availableMemoryBytes, modelName, t } = args;
  // Only a RAM refusal gets this sentence: tier/disk refusals already refuse
  // the download outright, and an allowed verdict must not nag.
  if (gate.allowed || gate.reason !== "blocked_ram") return null;
  // The verdict's own precondition makes both numbers present; if they ever
  // are not, the plain reason is still true — a warning with fabricated
  // numbers would not be.
  if (gate.nonEvictableMiB === null || availableMemoryBytes === null) {
    return t("models.blockedRam");
  }
  return t("download.confirmLowMemory", {
    name: modelName,
    need: Math.round((gate.nonEvictableMiB * BYTES_PER_MIB) / BYTES_PER_MB),
    free: Math.round(availableMemoryBytes / BYTES_PER_MB),
  });
}
