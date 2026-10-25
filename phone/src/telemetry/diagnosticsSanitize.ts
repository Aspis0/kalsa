/**
 * Allowlist boundary for v2 diagnostics. Raw facts go in as unknown values;
 * only contract enums, bucket labels and canonical signatures come out.
 */
import {
  DIAG_BREADCRUMB_LIMIT,
  DIAG_COMPONENTS,
  DIAG_CPU_MODEL_PATTERN,
  DIAG_HARDWARE_MAX_CHARS,
  DIAG_MODEL_IDS,
  DIAG_STAGES,
  type DiagBackend,
  type DiagComponent,
  type DiagModelId,
  type DiagOffload,
  type DiagStage,
  type DiagThermal,
} from "./diagnosticsContract";
import {
  contextTokensBucket,
  promptTokensBucket,
  sinceStartBucket,
  tokensPerSecondBucket,
} from "./diagnosticsBuckets";
import { snapdragonMarketingName } from "./diagnosticsSocModel";
import { signatureFromMessage } from "./diagnosticsSignature";

type DiagBreadcrumb = {
  component: DiagComponent;
  stage: DiagStage;
  sinceStart?: string;
};

/** Field names match the Worker's diagnostics keys (contract-v2.ts). */
export type Diagnostics = {
  component: DiagComponent;
  stage: DiagStage;
  osFamily: "android" | "ios";
  arch?: "aarch64";
  backend?: DiagBackend;
  offload?: DiagOffload;
  thermal?: DiagThermal;
  modelId?: DiagModelId;
  cpuModel?: string;
  ctxTokens?: string;
  promptTokens?: string;
  tokensPerSecond?: string;
  sinceStart?: string;
  signature?: string;
  breadcrumbs?: DiagBreadcrumb[];
};

/** One state transition in the trail; sinceSeconds is bucketed on the way out. */
export type RawCrumb = { component: unknown; stage: unknown; sinceSeconds: number };

export type RawDiagnosticInput = {
  component: unknown;
  stage: unknown;
  /** Signature source only; never copied into the report. */
  rawMessage?: unknown;
  breadcrumbs: readonly RawCrumb[];
  sinceStartSeconds: number;
  modelId?: unknown;
  contextTokens?: unknown;
  socModel?: unknown;
  /** Only the current attempt's facts; empty until its governor line arrives. */
  turn: {
    enginePrefill?: unknown;
    engineDecode?: unknown;
    thermalState?: unknown;
    platformThermalStatus?: unknown;
    promptTokens?: unknown;
    promptMs?: unknown;
    decodeTokensPerSecond?: unknown;
  };
};

const CPU_MODEL_RE = new RegExp(DIAG_CPU_MODEL_PATTERN);

function pick<const T extends readonly string[]>(list: T, value: unknown): T[number] | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function backendFor(engine: unknown, platform: "android" | "ios"): DiagBackend | undefined {
  if (engine === undefined || engine === null) return undefined;
  if (engine === "CPU") return "cpu";
  if (engine === "GPU") return platform === "ios" ? "metal" : "opencl";
  return "unknown";
}

function offloadFor(engine: unknown): DiagOffload | undefined {
  if (engine === "CPU") return "cpu";
  if (engine === "GPU") return "gpu";
  return undefined;
}

const THERMAL_BY_GOVERNOR_STATE = new Map<string, DiagThermal>([
  ["FAST", "nominal"],
  ["WARM", "fair"],
  ["COOLMODE", "serious"],
  ["CRITICAL", "critical"],
]);

/**
 * Governor thermal_state first. Its LOWBAT/Unknown/Invalid values say nothing
 * about heat, so they fall to the Android PowerManager status (0 none … 6
 * shutdown) before becoming "unknown".
 */
function thermalFor(state: unknown, platformStatus: unknown): DiagThermal | undefined {
  const mapped = typeof state === "string" ? THERMAL_BY_GOVERNOR_STATE.get(state) : undefined;
  if (mapped) return mapped;
  const status = finiteNumber(platformStatus);
  if (status === undefined) return state === undefined ? undefined : "unknown";
  if (status === 0) return "nominal";
  if (status <= 2) return "fair";
  if (status === 3) return "serious";
  if (status <= 6) return "critical";
  return "unknown";
}

function tokensPerSecondFor(stage: DiagStage, turn: RawDiagnosticInput["turn"]): string | undefined {
  if (stage === "prefill") {
    const tokens = finiteNumber(turn.promptTokens);
    const ms = finiteNumber(turn.promptMs);
    if (tokens === undefined || ms === undefined || tokens <= 0 || ms <= 0) return undefined;
    return tokensPerSecondBucket((tokens / ms) * 1000);
  }
  if (stage === "decode") {
    const rate = finiteNumber(turn.decodeTokensPerSecond);
    return rate === undefined || rate <= 0 ? undefined : tokensPerSecondBucket(rate);
  }
  return undefined;
}

function cpuModelFor(socModel: unknown): string | undefined {
  if (typeof socModel !== "string") return undefined;
  const marketing = snapdragonMarketingName(socModel);
  if (marketing) return marketing;
  return socModel.length <= DIAG_HARDWARE_MAX_CHARS && CPU_MODEL_RE.test(socModel) ? socModel : undefined;
}

function breadcrumbsFor(crumbs: readonly RawCrumb[]): DiagBreadcrumb[] {
  const out: DiagBreadcrumb[] = [];
  for (const crumb of crumbs.slice(-DIAG_BREADCRUMB_LIMIT)) {
    const component = pick(DIAG_COMPONENTS, crumb.component);
    const stage = pick(DIAG_STAGES, crumb.stage);
    if (!component || !stage) continue;
    out.push({ component, stage, sinceStart: sinceStartBucket(crumb.sinceSeconds) });
  }
  return out;
}

/** Undefined when the failure location is not a contract component/stage. */
export function sanitizeDiagnostics(
  raw: RawDiagnosticInput,
  platform: "android" | "ios",
): Diagnostics | undefined {
  const component = pick(DIAG_COMPONENTS, raw.component);
  const stage = pick(DIAG_STAGES, raw.stage);
  if (!component || !stage) return undefined;

  const contextTokens = finiteNumber(raw.contextTokens);
  const promptTokens = finiteNumber(raw.turn.promptTokens);
  const d: Diagnostics = { component, stage, osFamily: platform };

  if (platform === "ios") d.arch = "aarch64";
  const engine = stage === "prefill" ? raw.turn.enginePrefill
    : stage === "decode" ? raw.turn.engineDecode
    : undefined;
  const backend = backendFor(engine, platform);
  if (backend) d.backend = backend;
  const offload = offloadFor(engine);
  if (offload) d.offload = offload;
  const thermal = thermalFor(raw.turn.thermalState, raw.turn.platformThermalStatus);
  if (thermal) d.thermal = thermal;
  const modelId = pick(DIAG_MODEL_IDS, raw.modelId);
  if (modelId) d.modelId = modelId;
  const cpuModel = cpuModelFor(raw.socModel);
  if (cpuModel) d.cpuModel = cpuModel;
  if (contextTokens !== undefined && contextTokens > 0) d.ctxTokens = contextTokensBucket(contextTokens);
  if (promptTokens !== undefined && promptTokens >= 0) d.promptTokens = promptTokensBucket(promptTokens);
  const rate = tokensPerSecondFor(stage, raw.turn);
  if (rate) d.tokensPerSecond = rate;
  d.sinceStart = sinceStartBucket(raw.sinceStartSeconds);
  const signature = signatureFromMessage(typeof raw.rawMessage === "string" ? raw.rawMessage : undefined);
  if (signature) d.signature = signature;
  const breadcrumbs = breadcrumbsFor(raw.breadcrumbs);
  if (breadcrumbs.length > 0) d.breadcrumbs = breadcrumbs;
  return d;
}
