/**
 * Runtime A/B bench knobs (AsyncStorage).
 * Defaults preserve production behaviour.
 *
 * Configure without root / rebuild via chat command (adb input text works):
 *   /bench thinking <default|budget256|budget512>
 *   /bench format <none|system-end|user-prefix|user-note>
 *   /bench speculative <none|mtp|clear>
 *   /bench engine <gpu=N,threads=N,threadsPrefill=N,ubatch=N|moe=on,...|clear>
 *   /bench show
 * Prefer the slash-free form on Windows Git Bash (adb mangles leading `/`):
 *   bench:thinking default
 *   bench:format user-note
 *   bench:speculative none
 *   bench:engine moe=on,cacheMb=2000,ioThreads=4,overlap=on,dense=anon
 *   bench:show
 *
 * Speculative applies at ENGINE INIT — force-stop + relaunch the app for the
 * new value to take effect (chat write alone is not enough mid-session).
 *
 * Engine applies at ENGINE INIT — force-stop + relaunch (same as speculative).
 *
 * Keys:
 * - kalsa.bench.thinking: "default" | "budget256" | "budget512"
 * - kalsa.bench.format:   "none" | "system-end" | "user-prefix" | "user-note"
 * - kalsa.bench.speculative: JSON { type, nMax?, draftModelPath? } (CI A/B only)
 * - kalsa.bench.engine: JSON { nGpuLayers?, nThreads?, nThreadsPrefill?, nUbatch?, flashAttn?, moeStream? } (CI A/B only)
 * - kalsa.bench.toolchoice: "auto" | "required" | "none" (CI A/B only)
 * - kalsa.bench.toolgate:   "1" (default) | "0" (CI A/B only)
 * - kalsa.bench.norepack:   "1" disables weight repacking (CI A/B only)
 *
 * No in-memory cache: one fresh read per turn (best-effort).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getThreadCountSource } from "../engine/threadProfile";
import type {
  EngineOverrideFields,
  FlashAttnMode,
} from "../engine/engineParams";
import { parseBenchNCtx } from "../engine/contextProfile";
import {
  parseBenchWindowBudget,
  parseBenchLegacyWindow,
  parseBenchRanking,
  parseBenchDigestCadence,
} from "../context/compactor";

export const BENCH_THINKING_KEY = "kalsa.bench.thinking";
export const BENCH_FORMAT_KEY = "kalsa.bench.format";
export const BENCH_SPECULATIVE_KEY = "kalsa.bench.speculative";
export const BENCH_ENGINE_KEY = "kalsa.bench.engine";
export const BENCH_TOOLCHOICE_KEY = "kalsa.bench.toolchoice";
export const BENCH_TOOLGATE_KEY = "kalsa.bench.toolgate";
export const BENCH_NCTX_KEY = "kalsa.bench.nctx";
export const BENCH_WINBUDGET_KEY = "kalsa.bench.winbudget";
export const BENCH_LEGACYWINDOW_KEY = "kalsa.bench.legacywindow";
export const BENCH_RANKING_KEY = "kalsa.bench.ranking";
export const BENCH_DIGESTCADENCE_KEY = "kalsa.bench.digestcadence";
/** "1" disables weight repacking (no_extra_bufts). Absent / other → production. */
export const BENCH_NOREPACK_KEY = "kalsa.bench.norepack";

export type ThinkingMode = "default" | "budget256" | "budget512";
export type BlockFormat = "none" | "system-end" | "user-prefix" | "user-note";
/**
 * Bench-only measurement knob, not a product default.
 * Forcing a call on every turn is known to be wrong for a real user
 * (it would fire on memorisation turns); the value of the arm is that
 * it bounds how much recall is available, and how much precision that costs.
 */
export type ToolChoiceMode = "auto" | "required" | "none";
export type CompletionToolChoice = "auto" | "required" | "none";

export type SpeculativeOverride = {
  /** "none" disables speculation entirely — the plain-decode baseline arm. */
  type: "none" | "draft-mtp" | "draft-dflash";
  nMax?: number;
  draftModelPath?: string;
};

export type EngineOverride = {
  nGpuLayers?: number;
  nThreads?: number;
  nThreadsPrefill?: number;
  nUbatch?: number;
  /** Android needs "off" alongside nGpuLayers — see applyEngineOverride. */
  flashAttn?: FlashAttnMode;
  moeStream?: EngineOverrideFields["moeStream"];
  /** Bench-only residency probe; see engineParams.useMmap. */
  useMmap?: boolean;
};

type MoeStreamOverride = NonNullable<EngineOverride["moeStream"]>;

type EngineNumericKey =
  | "nGpuLayers"
  | "nThreads"
  | "nThreadsPrefill"
  | "nUbatch";

const DENSE_WEIGHT_MODES = new Set([
  "mmap",
  "warm",
  "anon",
  "ahwb",
  "anon-gpu",
]);
const MOE_STREAM_KEYS = new Set([
  "moe",
  "cacheMb",
  "cachemb",
  "ioThreads",
  "iothreads",
  "overlap",
  "dense",
]);

function parseUnsignedInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isValidMoeCacheMb(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (value === 0 || value >= 1500)
  );
}

function isValidMoeIoThreads(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 8
  );
}

function applyMoeStreamPair(
  key: string,
  value: string,
  moeStream: MoeStreamOverride,
): boolean {
  if (key === "moe") {
    if (value !== "on" && value !== "off") return false;
    moeStream.enabled = value === "on";
    return true;
  }

  if (key === "cacheMb" || key === "cachemb") {
    const parsed = parseUnsignedInteger(value);
    if (!isValidMoeCacheMb(parsed)) return false;
    moeStream.cache_mb = parsed;
    // An explicit budget and RAM-derived sizing are mutually exclusive.
    moeStream.cache_auto = false;
    return true;
  }

  if (key === "ioThreads" || key === "iothreads") {
    const parsed = parseUnsignedInteger(value);
    if (!isValidMoeIoThreads(parsed)) return false;
    moeStream.io_threads = parsed;
    return true;
  }

  if (key === "overlap") {
    if (value !== "on" && value !== "off") return false;
    moeStream.overlap = value === "on";
    return true;
  }

  if (key === "dense") {
    if (!DENSE_WEIGHT_MODES.has(value)) return false;
    moeStream.dense_weights = value;
    return true;
  }

  return false;
}

function readMoeStreamOverride(value: unknown): MoeStreamOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const moeStream: MoeStreamOverride = {};

  if ("enabled" in source) {
    if (typeof source.enabled !== "boolean") return undefined;
    moeStream.enabled = source.enabled;
  }

  if ("cache_mb" in source) {
    if (!isValidMoeCacheMb(source.cache_mb)) return undefined;
    if (source.cache_auto !== undefined && source.cache_auto !== false) {
      return undefined;
    }
    moeStream.cache_mb = source.cache_mb;
    moeStream.cache_auto = false;
  } else if ("cache_auto" in source) {
    if (typeof source.cache_auto !== "boolean") return undefined;
    moeStream.cache_auto = source.cache_auto;
  }

  if ("io_threads" in source) {
    if (!isValidMoeIoThreads(source.io_threads)) return undefined;
    moeStream.io_threads = source.io_threads;
  }

  if ("overlap" in source) {
    if (typeof source.overlap !== "boolean") return undefined;
    moeStream.overlap = source.overlap;
  }

  if ("dense_weights" in source) {
    if (
      typeof source.dense_weights !== "string" ||
      !DENSE_WEIGHT_MODES.has(source.dense_weights)
    ) {
      return undefined;
    }
    moeStream.dense_weights = source.dense_weights;
  }

  return Object.keys(moeStream).length > 0 ? moeStream : undefined;
}

/** GPU zero means CPU-only; thread and batch counts must be positive. */
function isValidEngineOverrideNumber(
  key: EngineNumericKey,
  value: unknown,
): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
  return key === "nGpuLayers" ? value >= 0 : value > 0;
}

/**
 * Optional getter for the engine-active knob (JSON string | undefined).
 * LlamaService registers at module load so formatBenchStatus can report ACTIVE
 * without importing LlamaService (import cycle + harness must not load llama.rn).
 * Unregistered → "none" (node harness / never inited).
 */
let activeEngineKnobGetter: (() => string | undefined) | undefined;

/** Called by LlamaService once at load. Safe to call from tests. */
export function registerActiveEngineKnobGetter(
  getter: () => string | undefined,
): void {
  activeEngineKnobGetter = getter;
}

/** Compact label for engine override (storage or ACTIVE). */
function formatEngineLabel(engine: EngineOverride | undefined): string {
  if (!engine) return "default";
  const parts: string[] = [];
  if (engine.nGpuLayers !== undefined) parts.push(`gpu:${engine.nGpuLayers}`);
  if (engine.nThreads !== undefined) parts.push(`threads:${engine.nThreads}`);
  if (engine.nThreadsPrefill !== undefined) {
    parts.push(`threadsPrefill:${engine.nThreadsPrefill}`);
  }
  if (engine.nUbatch !== undefined) parts.push(`ubatch:${engine.nUbatch}`);
  if (engine.flashAttn !== undefined) parts.push(`fa:${engine.flashAttn}`);
  if (engine.moeStream !== undefined) {
    const moe = engine.moeStream;
    if (moe.enabled !== undefined) {
      parts.push(`moe:${moe.enabled ? "on" : "off"}`);
    }
    if (moe.cache_mb !== undefined) parts.push(`cacheMb:${moe.cache_mb}`);
    else if (moe.cache_auto !== undefined) {
      parts.push(`cacheAuto:${moe.cache_auto ? "on" : "off"}`);
    }
    if (moe.io_threads !== undefined) {
      parts.push(`ioThreads:${moe.io_threads}`);
    }
    if (moe.overlap !== undefined) {
      parts.push(`overlap:${moe.overlap ? "on" : "off"}`);
    }
    if (moe.dense_weights !== undefined) parts.push(`dense:${moe.dense_weights}`);
  }
  if (engine.useMmap !== undefined) {
    parts.push(`mmap:${engine.useMmap ? "on" : "off"}`);
  }
  return parts.length > 0 ? parts.join(",") : "default";
}

/**
 * Label for the knob currently live on the running engine.
 * "none" when getter never registered (harness path).
 */
function activeEngineLabel(): string {
  if (!activeEngineKnobGetter) return "none";
  const raw = activeEngineKnobGetter();
  if (raw === undefined) return "default";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return "default";
    const o = parsed as Record<string, unknown>;
    const engine: EngineOverride = {};
    for (const key of [
      "nGpuLayers",
      "nThreads",
      "nThreadsPrefill",
      "nUbatch",
    ] as const) {
      const n = o[key];
      if (isValidEngineOverrideNumber(key, n)) {
        engine[key] = n;
      }
    }
    const fa = o.flashAttn;
    if (fa === "auto" || fa === "on" || fa === "off") {
      engine.flashAttn = fa;
    }
    const moeStream = readMoeStreamOverride(o.moeStream);
    if (moeStream) engine.moeStream = moeStream;
    return formatEngineLabel(
      Object.keys(engine).length > 0 ? engine : undefined,
    );
  } catch {
    return "none";
  }
}

const THINKING_MODES: ReadonlySet<string> = new Set([
  "default",
  "budget256",
  "budget512",
]);

const BLOCK_FORMATS: ReadonlySet<string> = new Set([
  "none",
  "system-end",
  "user-prefix",
  "user-note",
]);

const TOOLCHOICE_MODES: ReadonlySet<string> = new Set([
  "auto",
  "required",
  "none",
]);

/**
 * Read thinking mode for the next completion. Invalid and stale values,
 * including the retired "off" value, fall back to "default" so old storage
 * never disables reasoning or crashes the caller.
 */
export async function getThinkingMode(): Promise<ThinkingMode> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_THINKING_KEY);
    if (raw && THINKING_MODES.has(raw)) return raw as ThinkingMode;
  } catch {
    // best-effort
  }
  return "default";
}

/** Read operative-block placement format. Defaults to "none" (no block). */
export async function getBlockFormat(): Promise<BlockFormat> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_FORMAT_KEY);
    if (raw && BLOCK_FORMATS.has(raw)) return raw as BlockFormat;
  } catch {
    // best-effort
  }
  return "none";
}

/** Read bench tool_choice mode. Absent / invalid → "auto" (production). */
export async function getToolChoiceMode(): Promise<ToolChoiceMode> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_TOOLCHOICE_KEY);
    if (raw && TOOLCHOICE_MODES.has(raw)) return raw as ToolChoiceMode;
  } catch {
    // best-effort
  }
  return "auto";
}

/**
 * Bench-only n_ctx override. Absent / invalid / below floor (2048) → null
 * (catalog n_ctx wins). The parser rejects 0, NaN, and sub-floor values
 * rather than passing them through to a silent clamp.
 */
export async function getBenchNCtx(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_NCTX_KEY);
    return parseBenchNCtx(raw);
  } catch {
    return null;
  }
}

/**
 * Bench-only verbatim-window char budget. Absent / invalid / below floor → null
 * (WINDOW_CHAR_BUDGET wins). This is the knob that controls when the legacy
 * digest path (`ciswire`) rebuilds: shouldRebuild fires on this budget and on
 * its K-turn cadence, never on n_ctx. Anchored uses its own pressure trigger.
 */
export async function getBenchWindowBudget(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_WINBUDGET_KEY);
    return parseBenchWindowBudget(raw);
  } catch {
    return null;
  }
}

/**
 * Bench-only legacy-window override. Absent / invalid / below floor (4) → null
 * (LEGACY_MAX_HISTORY / LEGACY_MAX_HISTORY_IMAGES win). This is the knob that
 * decides what falls out of context on BOTH arms of the primary comparison
 * (ciswire vs off): the same eviction on both, so the baseline loses planted
 * facts and ciswire should recover them via the digest.
 */
export async function getBenchLegacyWindow(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_LEGACYWINDOW_KEY);
    return parseBenchLegacyWindow(raw);
  } catch {
    return null;
  }
}

/**
 * Bench-only digest-injection cadence. Absent / invalid / below 1 → null
 * (production: the operative block rides every user turn). K > 1 injects only on
 * turns where `userTurnIndex % K === 0`, which is the arm that measures whether
 * the KV cost of injection is paid once per K turns instead of every turn.
 */
export async function getBenchDigestCadence(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_DIGESTCADENCE_KEY);
    return parseBenchDigestCadence(raw);
  } catch {
    return null;
  }
}

/** Ranking mode for the digest retriever. Absent / invalid → null ("bm25" wins). */
export type RankingMode = "bm25" | "hybrid";

/**
 * Bench-only ranking mode override. Absent / invalid → null (production "bm25"
 * wins). "hybrid" fuses BM25 + char 3-gram cosine via RRF (no model download).
 */
export async function getBenchRanking(): Promise<RankingMode | null> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_RANKING_KEY);
    return parseBenchRanking(raw);
  } catch {
    return null;
  }
}

/**
 * Bench-only rules-gate switch. Privacy gates are always on in release builds;
 * only a dev build may use "0" to disable the echo-of-context veto for an A/B
 * measurement.
 */
export async function getToolGateEnabled(): Promise<boolean> {
  if (typeof __DEV__ === "undefined" || __DEV__ !== true) return true;
  try {
    const raw = await AsyncStorage.getItem(BENCH_TOOLGATE_KEY);
    if (raw === "0") return false;
  } catch {
    // best-effort
  }
  return true;
}

/**
 * Pure parse for kalsa.bench.norepack, tri-state. "1" → true (no_extra_bufts,
 * disable ARM repack — existing semantics); "0" → false (repack forced ON — the
 * arm that lets a bench measure repack-on on models whose per-model policy
 * disables it); empty / absent / anything else → undefined (no bench opinion:
 * the per-model policy decides). Same "empty = catalog wins" shape as
 * parseBenchNCtx.
 */
export function parseBenchNoRepack(
  raw: string | null | undefined,
): boolean | undefined {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

/**
 * Tri-state weight-repack lever. Absent / invalid → undefined (production:
 * per-model loadPolicy decides). "1" → no_extra_bufts at engine init; "0" →
 * repack forced on. Applies at ENGINE INIT only.
 */
export async function getBenchNoRepack(): Promise<boolean | undefined> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_NOREPACK_KEY);
    return parseBenchNoRepack(raw);
  } catch {
    return undefined;
  }
}

/**
 * Value actually passed to llama.rn for one completion.
 *
 * Measurement knob, not a product default: forcing a call on every turn is
 * known to be wrong for a real user (it would fire on memorisation turns);
 * the value of the arm is that it bounds how much recall is available, and
 * how much precision that costs.
 *
 * `isFinalToolRound` and `forceTextOnly` always win → "none" so a turn can
 * still produce a text answer. `required` is first-round only.
 */
export function resolveCompletionToolChoice(args: {
  hasTools: boolean;
  isFinalToolRound: boolean;
  forceTextOnly: boolean;
  round: number;
  benchMode: ToolChoiceMode;
}): CompletionToolChoice {
  if (!args.hasTools || args.isFinalToolRound || args.forceTextOnly) {
    return "none";
  }
  if (args.benchMode === "none") return "none";
  if (args.benchMode === "required" && args.round === 0) return "required";
  return "auto";
}

/**
 * Bench-only DFlash/MTP speculative override for CI A/B.
 * AsyncStorage key `kalsa.bench.speculative` = JSON
 *   { "type": "draft-dflash"|"draft-mtp", "nMax"?: number, "draftModelPath"?: string }
 * absent/invalid → undefined (production MTP path via catalog mtpNMax).
 *
 * CI seed (seed_kv / sqlite INSERT OR REPLACE):
 *   seed_kv kalsa.bench.speculative '{"type":"draft-dflash","draftModelPath":"/data/data/com.kalsa.app/files/models/draft/Qwen3.5-4B-DFlash-Q8_0.gguf"}'
 * Draft GGUF is adb-pushed into app files dir + models/draft/ — no download manager.
 *
 * Chat path (device A/B, no root): `/bench speculative none|mtp|clear` —
 * dflash still needs draftModelPath, so seed via JSON as above (not via chat).
 * Applies at ENGINE INIT — force-stop + relaunch after writing.
 */
export async function getSpeculativeOverride(): Promise<SpeculativeOverride | undefined> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_SPECULATIVE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const o = parsed as Record<string, unknown>;
    if (o.type !== "none" && o.type !== "draft-mtp" && o.type !== "draft-dflash") return undefined;
    const out: SpeculativeOverride = { type: o.type };
    if (typeof o.nMax === "number" && Number.isFinite(o.nMax) && o.nMax > 0) {
      out.nMax = o.nMax;
    }
    if (typeof o.draftModelPath === "string" && o.draftModelPath.length > 0) {
      out.draftModelPath = o.draftModelPath;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Pure parse of a `/bench speculative <arg>` token.
 * Returns a SpeculativeOverride to persist, `"clear"` to remove the key
 * (production path), or null if the arg is not supported via chat
 * (e.g. dflash needs draftModelPath — seed JSON instead).
 */
export function parseSpeculativeArg(
  arg: string,
): SpeculativeOverride | "clear" | null {
  switch (arg) {
    case "none":
      return { type: "none" };
    case "mtp":
      return { type: "draft-mtp" };
    case "clear":
    case "default":
      return "clear";
    default:
      return null;
  }
}

/** Persist thinking mode. Returns false if value is invalid. */
export async function setThinkingMode(mode: string): Promise<boolean> {
  if (!THINKING_MODES.has(mode)) return false;
  try {
    await AsyncStorage.setItem(BENCH_THINKING_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** Persist block format. Returns false if value is invalid. */
export async function setBlockFormat(format: string): Promise<boolean> {
  if (!BLOCK_FORMATS.has(format)) return false;
  try {
    await AsyncStorage.setItem(BENCH_FORMAT_KEY, format);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist speculative override for A/B. Returns false if mode is invalid.
 * `"none"` / `"mtp"` write JSON; `"clear"` / `"default"` remove the key
 * (production path). dflash is intentionally not supported here.
 */
export async function setSpeculativeOverride(mode: string): Promise<boolean> {
  const parsed = parseSpeculativeArg(mode);
  if (parsed === null) return false;
  try {
    if (parsed === "clear") {
      await AsyncStorage.removeItem(BENCH_SPECULATIVE_KEY);
    } else {
      await AsyncStorage.setItem(BENCH_SPECULATIVE_KEY, JSON.stringify(parsed));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure parse of a `/bench engine <arg>` token.
 * Comma-separated k=v pairs: gpu, threads, threadsPrefill, ubatch, fa, moe,
 * cacheMb, ioThreads, overlap, dense. Numeric values are safe integers;
 * threads/threadsPrefill/ubatch must be > 0, ioThreads is 1..8, and cacheMb
 * is 0 or at least 1500.
 * `"clear"` / `"default"` remove the key. Thread counts above the core count
 * are retained for intentional oversubscription; unsafe integers are rejected.
 * Returns EngineOverride, `"clear"`, or null if invalid.
 */
export function parseEngineArg(arg: string): EngineOverride | "clear" | null {
  const trimmed = arg.trim();
  if (!trimmed) return null;
  if (trimmed === "clear" || trimmed === "default") return "clear";

  const out: EngineOverride = {};
  const moeStream: MoeStreamOverride = {};
  let hasMoeStream = false;
  let any = false;
  for (const pair of trimmed.split(",")) {
    const p = pair.trim();
    if (!p) return null;
    const eq = p.indexOf("=");
    if (eq <= 0) return null;
    const key = p.slice(0, eq).trim();
    const valStr = p.slice(eq + 1).trim();
    // fa is the only non-numeric key; handle it before the digits-only check.
    if (key === "fa") {
      if (valStr !== "auto" && valStr !== "on" && valStr !== "off") return null;
      out.flashAttn = valStr;
      any = true;
      continue;
    }
    if (MOE_STREAM_KEYS.has(key)) {
      if (!applyMoeStreamPair(key, valStr, moeStream)) return null;
      hasMoeStream = true;
      any = true;
      continue;
    }
    if (!/^\d+$/.test(valStr)) return null;
    const n = Number(valStr);
    const outputKey: EngineNumericKey | undefined =
      key === "gpu"
        ? "nGpuLayers"
        : key === "threads"
          ? "nThreads"
          : key === "threadsPrefill" || key === "threadsprefill"
            ? "nThreadsPrefill"
            : key === "ubatch"
              ? "nUbatch"
              : undefined;
    if (!outputKey || !isValidEngineOverrideNumber(outputKey, n)) return null;
    out[outputKey] = n;
    any = true;
  }
  if (hasMoeStream) out.moeStream = moeStream;
  return any ? out : null;
}

/**
 * Bench-only init-time engine param override (GPU layers / decode threads /
 * prefill threads / ubatch / MoE streaming).
 * AsyncStorage key `kalsa.bench.engine` = JSON
 *   { "nGpuLayers"?, "nThreads"?, "nThreadsPrefill"?, "nUbatch"?: number, "flashAttn"?: "auto"|"on"|"off", "moeStream"?: object }
 * absent/invalid → undefined (production defaults).
 * Applies at ENGINE INIT — force-stop + relaunch after writing.
 */
export async function getEngineOverride(): Promise<EngineOverride | undefined> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_ENGINE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const o = parsed as Record<string, unknown>;
    const out: EngineOverride = {};
    for (const key of [
      "nGpuLayers",
      "nThreads",
      "nThreadsPrefill",
      "nUbatch",
    ] as const) {
      const n = o[key];
      if (isValidEngineOverrideNumber(key, n)) {
        out[key] = n;
      }
    }
    const fa = o.flashAttn;
    if (fa === "auto" || fa === "on" || fa === "off") {
      out.flashAttn = fa;
    }
    const moeStream = readMoeStreamOverride(o.moeStream);
    if (moeStream) out.moeStream = moeStream;
    // Boolean-only on purpose: any other value must leave the field ABSENT, so
    // a malformed pref cannot turn a production load into a non-mmap one.
    if (typeof o.useMmap === "boolean") out.useMmap = o.useMmap;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist engine override for A/B. Returns false if arg is invalid.
 * k=v pairs write JSON; `"clear"` / `"default"` remove the key
 * (production defaults).
 */
export async function setEngineOverride(arg: string): Promise<boolean> {
  const parsed = parseEngineArg(arg);
  if (parsed === null) return false;
  try {
    if (parsed === "clear") {
      await AsyncStorage.removeItem(BENCH_ENGINE_KEY);
    } else {
      await AsyncStorage.setItem(BENCH_ENGINE_KEY, JSON.stringify(parsed));
    }
    return true;
  } catch {
    return false;
  }
}

/** Current config as a short debug string. */
export async function formatBenchStatus(): Promise<string> {
  const thinking = await getThinkingMode();
  const format = await getBlockFormat();
  const speculative = await getSpeculativeOverride();
  const speculativeLabel = speculative?.type ?? "default";
  const engine = await getEngineOverride();
  const engineLabel = formatEngineLabel(engine);
  // Pending (storage) vs ACTIVE (running engine init). Differ when operator
  // wrote a knob but has not force-stop + relaunch yet — the class of mistake
  // that invalidated a prior measurement campaign.
  const activeLabel = activeEngineLabel();
  const enginePart =
    activeLabel === engineLabel
      ? `engine=${engineLabel}`
      : `engine=${engineLabel} (ACTIVE: ${activeLabel} — force-stop + relaunch to apply)`;
  // threads_src: how detectThreadCount resolved (capacity vs fallback:*).
  // "unset" until the engine has probed; no log noise on the normal path.
  const threadsSrc = getThreadCountSource();
  return `bench: thinking=${thinking}, format=${format}, speculative=${speculativeLabel}, ${enginePart}, threads_src=${threadsSrc}`;
}

const BENCH_USAGE =
  "bench usage: /bench thinking <default|budget256|budget512> | bench:thinking <default|budget256|budget512> | /bench format <…> | bench:format <…> | /bench speculative <none|mtp|clear> | bench:speculative <none|mtp|clear> | /bench engine <gpu=N[,threads=N][,threadsPrefill=N][,ubatch=N][,moe=on|off][,cacheMb=N][,ioThreads=N][,overlap=on|off][,dense=mmap|warm|anon|ahwb|anon-gpu]|clear> | bench:engine <…> | /bench show | bench:show";

/** True when text is a bench debug command (`/bench …` or slash-free `bench:…`). */
export function isBenchCommand(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  return lower.startsWith("/bench ") || lower.startsWith("bench:");
}

/** Strip either accepted prefix; empty string if not a bench command. */
function stripBenchPrefix(trimmed: string): string {
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/bench ")) {
    return trimmed.slice("/bench ".length).trim();
  }
  if (lower.startsWith("bench:")) {
    return trimmed.slice("bench:".length).trim();
  }
  return "";
}

/**
 * If `text` is a bench debug command (`/bench …` or `bench:…`), apply it and
 * return a confirmation reply. Returns null when the text is not a bench
 * command (normal chat path). Never throws — storage failures surface as a
 * reply string.
 */
export async function tryHandleBenchCommand(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!isBenchCommand(trimmed)) return null;

  const parts = stripBenchPrefix(trimmed).split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "").toLowerCase();
  const arg = (parts[1] ?? "").toLowerCase();

  if (sub === "show" || sub === "") {
    return formatBenchStatus();
  }

  if (sub === "thinking") {
    if (!arg) {
      return `bench: missing thinking mode. ${BENCH_USAGE}`;
    }
    if (!THINKING_MODES.has(arg)) {
      return `bench: invalid thinking mode "${arg}". ${BENCH_USAGE}`;
    }
    const ok = await setThinkingMode(arg);
    if (!ok) return "bench: failed to write thinking mode";
    return formatBenchStatus();
  }

  if (sub === "format") {
    if (!arg) {
      return `bench: missing format. ${BENCH_USAGE}`;
    }
    if (!BLOCK_FORMATS.has(arg)) {
      return `bench: invalid format "${arg}". ${BENCH_USAGE}`;
    }
    const ok = await setBlockFormat(arg);
    if (!ok) return "bench: failed to write format";
    return formatBenchStatus();
  }

  if (sub === "speculative") {
    if (!arg) {
      return `bench: missing speculative mode. ${BENCH_USAGE}`;
    }
    if (parseSpeculativeArg(arg) === null) {
      return `bench: invalid speculative mode "${arg}". ${BENCH_USAGE}`;
    }
    const ok = await setSpeculativeOverride(arg);
    if (!ok) return "bench: failed to write speculative mode";
    return formatBenchStatus();
  }

  if (sub === "engine") {
    if (!arg) {
      return `bench: missing engine override. ${BENCH_USAGE}`;
    }
    const parsedEngine = parseEngineArg(arg);
    if (parsedEngine === null) {
      return `bench: invalid engine override "${arg}". ${BENCH_USAGE}`;
    }
    const ok = await setEngineOverride(arg);
    if (!ok) return "bench: failed to write engine override";
    // Machine-readable status line FIRST (CI greps it); optional warning after.
    // threads>=7 is still accepted (measurement tool must reach the zone) but
    // measured fact: threads>=7 has produced catastrophic decode on one device
    // (0.06 tok/s at threads=8 on an 8-core SD8Gen3). Affinity pinning is a
    // no-op on Android (see docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md); do not
    // attribute this to "pins N fastest / efficiency cores destroy throughput".
    const status = await formatBenchStatus();
    if (
      parsedEngine !== "clear" &&
      parsedEngine.nThreads !== undefined &&
      parsedEngine.nThreads >= 7
    ) {
      return (
        `${status}\n` +
        "bench: WARNING threads>=7 has produced catastrophic decode on one device " +
        "(0.06 tok/s at threads=8 on an 8-core SD8Gen3); use 6 or fewer for real numbers"
      );
    }
    return status;
  }

  return `bench: unknown subcommand "${sub}". ${BENCH_USAGE}`;
}
