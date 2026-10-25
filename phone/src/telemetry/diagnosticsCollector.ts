/**
 * In-process facts behind v2 diagnostics: the last few state transitions, the
 * current load, and the current turn. Nothing here leaves the device;
 * sanitizeDiagnostics decides what does.
 */
import { DIAG_BREADCRUMB_LIMIT, type DiagComponent, type DiagStage } from "./diagnosticsContract";
import { resolvedDeviceFacts } from "./deviceFacts";
import type { RawCrumb, RawDiagnosticInput } from "./diagnosticsSanitize";

type Crumb = { component: DiagComponent; stage: DiagStage; atMs: number };
type Timings = { prompt_n?: unknown; prompt_ms?: unknown; predicted_per_second?: unknown };

/** Process start: sinceStart buckets count from here. */
const processStartMs = Date.now();
let crumbs: Crumb[] = [];
let turn: RawDiagnosticInput["turn"] = {};
let turnDecodeMarked = false;
let load: { modelId: string | null; contextTokens: number } | null = null;

/**
 * Hooks sit on inference and load paths, so a collector fault must never reach
 * the caller. Guarding here covers every hook at once.
 */
function guarded(fn: () => void): void {
  try {
    fn();
  } catch {
    /* telemetry never breaks a turn */
  }
}

/** Consecutive repeats collapse, so repeated marks cost nothing in the trail. */
export function markStage(component: DiagComponent, stage: DiagStage, nowMs?: number): void {
  guarded(() => {
    const last = crumbs[crumbs.length - 1];
    if (last?.component === component && last.stage === stage) return;
    const atMs = nowMs ?? Date.now();
    crumbs = [...crumbs, { component, stage, atMs }].slice(-DIAG_BREADCRUMB_LIMIT);
  });
}

/** A load starts: facts from the previous model must not describe this one. */
export function beginLoad(): void {
  guarded(() => {
    load = null;
    markStage("engine", "load");
  });
}

/** A completion attempt starts: the previous turn's facts stop describing this one. */
export function beginPrefill(): void {
  guarded(() => {
    turn = {};
    turnDecodeMarked = false;
    markStage("engine", "prefill");
  });
}

/** Decode is marked once per attempt, on its first token, not on every token. */
export function markFirstToken(): void {
  guarded(() => {
    if (turnDecodeMarked) return;
    turnDecodeMarked = true;
    markStage("engine", "decode");
  });
}

export function recordLoad(facts: { modelId: string | null; contextTokens: number }): void {
  guarded(() => {
    load = facts;
  });
}

/** Reads the stats fields it needs; the caller's object is not retained. */
export function recordGovernorTurn(
  stats: {
    engine_prefill?: unknown;
    engine_decode?: unknown;
    thermal_state?: unknown;
    platform_thermal_status?: unknown;
  },
  completion: unknown,
): void {
  guarded(() => {
    const timings = timingsOf(completion);
    turn = {
      enginePrefill: stats.engine_prefill,
      engineDecode: stats.engine_decode,
      thermalState: stats.thermal_state,
      platformThermalStatus: stats.platform_thermal_status,
      promptTokens: timings?.prompt_n,
      promptMs: timings?.prompt_ms,
      decodeTokensPerSecond: timings?.predicted_per_second,
    };
  });
}

function timingsOf(completion: unknown): Timings | undefined {
  if (!completion || typeof completion !== "object") return undefined;
  const timings = (completion as { timings?: unknown }).timings;
  return timings && typeof timings === "object" ? (timings as Timings) : undefined;
}

/**
 * Facts for one report. `where` is the failure site; its stage defaults to
 * the component's latest recorded stage, then to "other".
 */
export function snapshotDiagnostics(
  where: {
    component: DiagComponent;
    stage?: DiagStage;
    rawMessage?: string;
    modelId?: string | null;
  },
  nowMs: number = Date.now(),
): RawDiagnosticInput {
  const stage = where.stage ?? latestStage(where.component) ?? "other";
  const trail = [...crumbs];
  const tail = trail[trail.length - 1];
  if (tail?.component !== where.component || tail.stage !== stage) {
    trail.push({ component: where.component, stage, atMs: nowMs });
  }
  return {
    component: where.component,
    stage,
    rawMessage: where.rawMessage,
    breadcrumbs: trail.slice(-DIAG_BREADCRUMB_LIMIT).map(toRawCrumb),
    sinceStartSeconds: secondsSince(processStartMs, nowMs),
    modelId: where.modelId ?? load?.modelId,
    contextTokens: load?.contextTokens,
    turn,
    socModel: resolvedDeviceFacts()?.socModel,
  };
}

function latestStage(component: DiagComponent): DiagStage | undefined {
  for (let i = crumbs.length - 1; i >= 0; i -= 1) {
    if (crumbs[i]!.component === component) return crumbs[i]!.stage;
  }
  return undefined;
}

function toRawCrumb(crumb: Crumb): RawCrumb {
  return { component: crumb.component, stage: crumb.stage, sinceSeconds: secondsSince(processStartMs, crumb.atMs) };
}

function secondsSince(startMs: number, atMs: number): number {
  return Math.max(0, (atMs - startMs) / 1000);
}

/** Test-only: clears the trail and every recorded fact. */
export function resetDiagnosticsForTests(): void {
  crumbs = [];
  turn = {};
  turnDecodeMarked = false;
  load = null;
}
