/**
 * Phone slice of the v2 diagnostics contract (workers/telemetry/contract-v2.ts).
 * Lists only what this app constructs. diagnosticsContract.test.ts pins every
 * value here to the Worker contract, so change both sides together.
 */

export const DIAG_COMPONENTS = ["engine", "governor", "web"] as const;
export type DiagComponent = (typeof DIAG_COMPONENTS)[number];

export const DIAG_STAGES = [
  "load",
  "prefill",
  "decode",
  "tool_call",
  "other",
] as const;
export type DiagStage = (typeof DIAG_STAGES)[number];

export type DiagBackend = "metal" | "opencl" | "cpu" | "unknown";
export type DiagOffload = "gpu" | "cpu";
export type DiagThermal = "nominal" | "fair" | "serious" | "critical" | "unknown";

/** Phone registry ids; the Worker accepts exactly these as phone model tokens. */
export const DIAG_MODEL_IDS = [
  "lfm2.5-2.6b",
  "multilingual-e5-small",
  "qwen3.5-4b",
  "whisper-tiny",
] as const;
export type DiagModelId = (typeof DIAG_MODEL_IDS)[number];

/** Copied verbatim from V2.patterns.cpuModel; the test asserts equality. */
export const DIAG_CPU_MODEL_PATTERN =
  "^(Intel(\\(R\\))? (Core(\\(TM\\))? (i[3579]-[0-9]{4,5}[A-Z]{0,3}|Ultra [3579] [0-9]{3}[A-Z]{0,2})|Celeron(\\(R\\))? [A-Z]?[0-9]{3,4}[A-Z]?|Pentium(\\(R\\))?( Gold| Silver)? [A-Z]?[0-9]{3,4}[A-Z]?)|AMD Ryzen [3579] [0-9]{4}[A-Z]{0,3}( [0-9]{1,2}-Core Processor)?|Apple M[1-9][0-9]?( Pro| Max| Ultra)?|(Qualcomm )?Snapdragon ([4-8](\\+)? Gen [1-9]|X (Elite|Plus))|A[0-9]{2}( Pro| Bionic)?)$";

export const DIAG_SIGNATURE_MAX_CHARS = 80;
export const DIAG_HARDWARE_MAX_CHARS = 80;
export const DIAG_BREADCRUMB_LIMIT = 8;
