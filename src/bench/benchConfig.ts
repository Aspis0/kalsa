/**
 * Runtime A/B bench knobs (AsyncStorage).
 * Defaults preserve production behaviour.
 *
 * Configure without root / rebuild via chat command (adb input text works):
 *   /bench thinking <default|off|budget256|budget512>
 *   /bench format <none|system-end|user-prefix|user-note>
 *   /bench speculative <none|mtp|clear>
 *   /bench engine <gpu=N,threads=N,ubatch=N|clear>
 *   /bench kvtranscript <1|0|on|off|clear>
 *   /bench show
 * Prefer the slash-free form on Windows Git Bash (adb mangles leading `/`):
 *   bench:thinking off
 *   bench:format user-note
 *   bench:speculative none
 *   bench:engine gpu=20,threads=5,ubatch=256
 *   bench:kvtranscript 1
 *   bench:show
 *
 * Speculative applies at ENGINE INIT — force-stop + relaunch the app for the
 * new value to take effect (chat write alone is not enough mid-session).
 *
 * Engine applies at ENGINE INIT — force-stop + relaunch (same as speculative).
 *
 * Keys:
 * - kalsa.bench.thinking: "default" | "off" | "budget256" | "budget512"
 * - kalsa.bench.format:   "none" | "system-end" | "user-prefix" | "user-note"
 * - kalsa.bench.speculative: JSON { type, nMax?, draftModelPath? } (CI A/B only)
 * - kalsa.bench.engine: JSON { nGpuLayers?, nThreads?, nUbatch? } (CI A/B only)
 * - kalsa.bench.toolchoice: "auto" | "required" | "none" (CI A/B only)
 * - kalsa.bench.toolgate:   "1" (default) | "0" (CI A/B only)
 * - kalsa.bench.norepack:   "1" disables weight repacking (CI A/B only)
 * - kalsa.bench.kvtranscript: "1" enables append-only KV transcript (CI A/B only)
 *
 * No in-memory cache: one fresh read per turn (best-effort).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getThreadCountSource } from "../engine/threadProfile";
import { parseBenchNCtx } from "../engine/contextProfile";
import { parseBenchWindowBudget, parseBenchLegacyWindow, parseBenchRanking } from "../context/compactor";

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
/** "1" disables weight repacking (no_extra_bufts). Absent / other → production. */
export const BENCH_NOREPACK_KEY = "kalsa.bench.norepack";
/** "1" enables append-only KV transcript. Absent / other → production (off). */
export const BENCH_KVTRANSCRIPT_KEY = "kalsa.bench.kvtranscript";

export type ThinkingMode = "default" | "off" | "budget256" | "budget512";
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
  nUbatch?: number;
};

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
  if (engine.nUbatch !== undefined) parts.push(`ubatch:${engine.nUbatch}`);
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
    for (const key of ["nGpuLayers", "nThreads", "nUbatch"] as const) {
      const n = o[key];
      if (
        typeof n === "number" &&
        Number.isFinite(n) &&
        Number.isInteger(n) &&
        n >= 0
      ) {
        engine[key] = n;
      }
    }
    return formatEngineLabel(
      Object.keys(engine).length > 0 ? engine : undefined,
    );
  } catch {
    return "none";
  }
}

const THINKING_MODES: ReadonlySet<string> = new Set([
  "default",
  "off",
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

/** Read thinking mode for the next completion. Defaults to "default". */
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
 * (WINDOW_CHAR_BUDGET wins). This is the knob that actually controls how often
 * the compactor runs: shouldRebuild fires on this budget and on the K-turn
 * cadence, never on n_ctx.
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
 * Bench-only rules-gate switch. Absent / anything but "0" → on (production).
 * "0" disables the echo-of-context veto so the required arm can be measured
 * with and without the gate.
 */
export async function getToolGateEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_TOOLGATE_KEY);
    if (raw === "0") return false;
  } catch {
    // best-effort
  }
  return true;
}

/**
 * Pure parse for kalsa.bench.norepack. "1" → disable repacking; empty /
 * absent / anything else → false (production: repack on). Same "empty =
 * catalog wins" shape as parseBenchNCtx — only the explicit arm value bites.
 */
export function parseBenchNoRepack(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * Bench-only weight-repack disable. Absent / invalid → false (production
 * repack on). "1" → no_extra_bufts at engine init (saves ~file-size of
 * anonymous RSS; slower prefill). Applies at ENGINE INIT only.
 */
export async function getBenchNoRepack(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_NOREPACK_KEY);
    return parseBenchNoRepack(raw);
  } catch {
    return false;
  }
}

/**
 * Pure parse for kalsa.bench.kvtranscript. "1" → on; empty / absent /
 * anything else → false (production: messages path).
 */
export function parseBenchKvTranscript(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * Bench-only append-only KV transcript. Absent / invalid → false
 * (production: byte-identical messages completion). "1" → raw prompt T.
 */
export async function getKvTranscriptEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_KVTRANSCRIPT_KEY);
    return parseBenchKvTranscript(raw);
  } catch {
    return false;
  }
}

/**
 * Persist kvtranscript arm. "1"/"on" → "1"; "0"/"off" → "0";
 * "clear"/empty → delete key. Returns false if value is invalid.
 */
export async function setKvTranscriptEnabled(arg: string): Promise<boolean> {
  const normalized = arg.toLowerCase();
  try {
    if (normalized === "clear" || normalized === "") {
      await AsyncStorage.removeItem(BENCH_KVTRANSCRIPT_KEY);
      return true;
    }
    if (normalized === "1" || normalized === "on") {
      await AsyncStorage.setItem(BENCH_KVTRANSCRIPT_KEY, "1");
      return true;
    }
    if (normalized === "0" || normalized === "off") {
      await AsyncStorage.setItem(BENCH_KVTRANSCRIPT_KEY, "0");
      return true;
    }
    return false;
  } catch {
    return false;
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
 * Comma-separated k=v pairs: gpu, threads, ubatch (non-negative integers;
 * threads/ubatch must be > 0). `"clear"` / `"default"` remove the key.
 * Returns EngineOverride, `"clear"`, or null if invalid.
 */
export function parseEngineArg(arg: string): EngineOverride | "clear" | null {
  const trimmed = arg.trim();
  if (!trimmed) return null;
  if (trimmed === "clear" || trimmed === "default") return "clear";

  const out: EngineOverride = {};
  let any = false;
  for (const pair of trimmed.split(",")) {
    const p = pair.trim();
    if (!p) return null;
    const eq = p.indexOf("=");
    if (eq <= 0) return null;
    const key = p.slice(0, eq).trim();
    const valStr = p.slice(eq + 1).trim();
    if (!/^\d+$/.test(valStr)) return null;
    const n = Number(valStr);
    if (key === "gpu") {
      if (n < 0) return null;
      out.nGpuLayers = n;
      any = true;
    } else if (key === "threads") {
      if (n <= 0) return null;
      out.nThreads = n;
      any = true;
    } else if (key === "ubatch") {
      if (n <= 0) return null;
      out.nUbatch = n;
      any = true;
    } else {
      return null;
    }
  }
  return any ? out : null;
}

/**
 * Bench-only init-time engine param override (GPU layers / threads / ubatch).
 * AsyncStorage key `kalsa.bench.engine` = JSON
 *   { "nGpuLayers"?: number, "nThreads"?: number, "nUbatch"?: number }
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
    for (const key of ["nGpuLayers", "nThreads", "nUbatch"] as const) {
      const n = o[key];
      if (
        typeof n === "number" &&
        Number.isFinite(n) &&
        Number.isInteger(n) &&
        n >= 0
      ) {
        out[key] = n;
      }
    }
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
  const kvtranscript = (await getKvTranscriptEnabled()) ? "on" : "off";
  return `bench: thinking=${thinking}, format=${format}, speculative=${speculativeLabel}, ${enginePart}, threads_src=${threadsSrc}, kvtranscript=${kvtranscript}`;
}

const BENCH_USAGE =
  "bench usage: /bench thinking <…> | bench:thinking <…> | /bench format <…> | bench:format <…> | /bench speculative <none|mtp|clear> | bench:speculative <none|mtp|clear> | /bench engine <gpu=N[,threads=N][,ubatch=N]|clear> | bench:engine <…> | /bench kvtranscript <1|0|on|off|clear> | bench:kvtranscript <…> | /bench show | bench:show";

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

  if (sub === "kvtranscript") {
    const ok = await setKvTranscriptEnabled(arg);
    if (!ok) return `bench: invalid kvtranscript "${arg}". ${BENCH_USAGE}`;
    return formatBenchStatus();
  }

  return `bench: unknown subcommand "${sub}". ${BENCH_USAGE}`;
}
