/**
 * Runtime A/B bench knobs (AsyncStorage).
 * Defaults preserve production behaviour.
 *
 * Configure without root / rebuild via chat command (adb input text works):
 *   /bench thinking <default|off|budget256|budget512>
 *   /bench format <none|system-end|user-prefix|user-note>
 *   /bench show
 * Prefer the slash-free form on Windows Git Bash (adb mangles leading `/`):
 *   bench:thinking off
 *   bench:format user-note
 *   bench:show
 *
 * Keys:
 * - kalsa.bench.thinking: "default" | "off" | "budget256" | "budget512"
 * - kalsa.bench.format:   "none" | "system-end" | "user-prefix" | "user-note"
 * - kalsa.bench.speculative: JSON { type, nMax?, draftModelPath? } (CI A/B only)
 *
 * No in-memory cache: one fresh read per turn (best-effort).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const BENCH_THINKING_KEY = "kalsa.bench.thinking";
export const BENCH_FORMAT_KEY = "kalsa.bench.format";
export const BENCH_SPECULATIVE_KEY = "kalsa.bench.speculative";

export type ThinkingMode = "default" | "off" | "budget256" | "budget512";
export type BlockFormat = "none" | "system-end" | "user-prefix" | "user-note";

export type SpeculativeOverride = {
  /** "none" disables speculation entirely — the plain-decode baseline arm. */
  type: "none" | "draft-mtp" | "draft-dflash";
  nMax?: number;
  draftModelPath?: string;
};

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

/**
 * Bench-only DFlash/MTP speculative override for CI A/B.
 * AsyncStorage key `kalsa.bench.speculative` = JSON
 *   { "type": "draft-dflash"|"draft-mtp", "nMax"?: number, "draftModelPath"?: string }
 * absent/invalid → undefined (production MTP path via catalog mtpNMax).
 *
 * CI seed (seed_kv / sqlite INSERT OR REPLACE):
 *   seed_kv kalsa.bench.speculative '{"type":"draft-dflash","draftModelPath":"/data/data/com.kalsa.app/files/models/draft/Qwen3.5-4B-DFlash-Q8_0.gguf"}'
 * Draft GGUF is adb-pushed into app files dir + models/draft/ — no download manager.
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

/** Current config as a short debug string. */
export async function formatBenchStatus(): Promise<string> {
  const thinking = await getThinkingMode();
  const format = await getBlockFormat();
  return `bench: thinking=${thinking}, format=${format}`;
}

const BENCH_USAGE =
  "bench usage: /bench thinking <…> | bench:thinking <…> | /bench format <…> | bench:format <…> | /bench show | bench:show";

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

  return `bench: unknown subcommand "${sub}". ${BENCH_USAGE}`;
}
