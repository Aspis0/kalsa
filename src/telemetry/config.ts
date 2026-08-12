/**
 * Telemetry opt-in configuration (design TELEMETRY_OPTIN.md v14 FINAL + diag-addendum).
 * No secrets. No GitHub token. Worker URL only.
 */

/**
 * Production Worker base URL.
 *
 * RELEASE BUILD REQUIREMENT: a store/release APK MUST set this to the
 * deployed Worker origin (see workers/telemetry/README.md and the README
 * "Telemetry" note). Empty string is correct for local/dev/staging until
 * deploy; it silently disables network send (no unknown-endpoint fallback).
 * Device tests may override via AsyncStorage `kalsa.telemetry.url`.
 */
export const TELEMETRY_WORKER_URL: string =
  // Maintainer sets this after deploy (workers/telemetry/README.md).
  // Empty string keeps client fail-closed until a real URL or AsyncStorage override.
  "";

/** AsyncStorage key for local mock / staging URL override (device tests). */
export const TELEMETRY_URL_OVERRIDE_KEY = "kalsa.telemetry.url";

/** Dual-slot journal + pointer (never a single mutable blob). */
export const STATE_KEY_A = "kalsa.telemetry.state.A";
export const STATE_KEY_B = "kalsa.telemetry.state.B";
export const STATE_POINTER_KEY = "kalsa.telemetry.state.pointer";

/**
 * Durable opt-out tombstone — journal A/B + pointer (same protocol as the
 * state envelope). Highest valid-seq wins; torn/ambiguous → fail-closed OFF.
 * `OPTED_OUT_KEY` is the legacy single key, still read for migration.
 */
export const OPTED_OUT_KEY_A = "kalsa.telemetry.optedOut.A";
export const OPTED_OUT_KEY_B = "kalsa.telemetry.optedOut.B";
export const OPTED_OUT_POINTER_KEY = "kalsa.telemetry.optedOut.pointer";
/** @deprecated legacy single-key tombstone; read for migration only. */
export const OPTED_OUT_KEY = "kalsa.telemetry.optedOut";
/**
 * Crash-recovery intent written on OFF. If tombstone + journal both fail,
 * this marker still forces fail-closed OFF on the next load.
 */
export const PENDING_OFF_KEY = "kalsa.telemetry.pendingOff";
/**
 * Durable quarantine written BEFORE any other OFF I/O. Load discards any
 * leftover envelope while this key is present — even if pendingOff,
 * tombstone, and journal writes all fail.
 */
export const QUARANTINE_KEY = "kalsa.telemetry.quarantine";

/** Schema version for the client envelope and report payload. */
export const TELEMETRY_SCHEMA_V = 1 as const;

export const QUEUE_CAP = 50;
export const DEAD_CAP = 100;
export const DEAD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RETRY_CEILING = 5; // total attempts: retryCount 0..4 then dead at ==5
export const SENDING_LEASE_MS = 60_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 60 * 60 * 1000; // 1h
export const LOCAL_FINGERPRINT_CACHE = 32;
export const BODY_SOFT_LIMIT_BYTES = 4 * 1024;
export const SIGNAL_MAX_LEN = 80;

export const GITHUB_ISSUE_CHOOSE_URL =
  "https://github.com/Aspis0/kalsa/issues/new/choose";

export type ReasonCode =
  | "engine.init"
  | "chat.generation"
  | "embed.native"
  | "web.fetch"
  | "web.search"
  | "unknown";

/** web.fetch / web.search detail (diag-addendum). */
export type WebDetail =
  | "http_403"
  | "http_404"
  | "http_5xx"
  | "dns"
  | "tls"
  | "timeout"
  | "oom"
  | "payload_too_large"
  | "unknown";

/** engine.init detail. */
export type EngineInitDetail =
  | "oom"
  | "disk_full"
  | "model_corrupt"
  | "model_missing"
  | "init_timeout"
  | "native_crash"
  | "unknown";

/** chat.generation detail. */
export type ChatDetail =
  | "oom"
  | "native_crash"
  | "ctx_overflow"
  | "stop_aborted"
  | "unknown";

/** embed.native detail. */
export type EmbedDetail =
  | "oom"
  | "model_corrupt"
  | "native_crash"
  | "gate_aborted"
  | "unknown";

export type DetailValue =
  | WebDetail
  | EngineInitDetail
  | ChatDetail
  | EmbedDetail;

export type DeviceBucket = "low" | "mid" | "high";
export type MemoryClass = "lt-4gb" | "4-6gb" | "ge-6gb" | "unknown";
export type ModelCategory = "dense.2b" | "dense.4b" | "moe" | "unknown";
export type Phase = "download" | "load" | "turn" | "embed" | "flush";

export const REASON_CODES: readonly ReasonCode[] = [
  "engine.init",
  "chat.generation",
  "embed.native",
  "web.fetch",
  "web.search",
  "unknown",
] as const;

export const WEB_DETAILS: readonly WebDetail[] = [
  "http_403",
  "http_404",
  "http_5xx",
  "dns",
  "tls",
  "timeout",
  "oom",
  "payload_too_large",
  "unknown",
] as const;

export const ENGINE_INIT_DETAILS: readonly EngineInitDetail[] = [
  "oom",
  "disk_full",
  "model_corrupt",
  "model_missing",
  "init_timeout",
  "native_crash",
  "unknown",
] as const;

export const CHAT_DETAILS: readonly ChatDetail[] = [
  "oom",
  "native_crash",
  "ctx_overflow",
  "stop_aborted",
  "unknown",
] as const;

export const EMBED_DETAILS: readonly EmbedDetail[] = [
  "oom",
  "model_corrupt",
  "native_crash",
  "gate_aborted",
  "unknown",
] as const;

export const DEVICE_BUCKETS: readonly DeviceBucket[] = [
  "low",
  "mid",
  "high",
] as const;

export const MEMORY_CLASSES: readonly MemoryClass[] = [
  "lt-4gb",
  "4-6gb",
  "ge-6gb",
  "unknown",
] as const;

export const MODEL_CATEGORIES: readonly ModelCategory[] = [
  "dense.2b",
  "dense.4b",
  "moe",
  "unknown",
] as const;

export const PHASES: readonly Phase[] = [
  "download",
  "load",
  "turn",
  "embed",
  "flush",
] as const;

/** `unknown` has its own allowlist — never inherits engine-init details. */
export const UNKNOWN_DETAILS: readonly string[] = ["unknown"] as const;

/** Per-code detail allowlist (client + Worker share this contract). */
export function detailsForCode(code: ReasonCode): readonly string[] {
  if (code === "web.fetch" || code === "web.search") return WEB_DETAILS;
  if (code === "engine.init") return ENGINE_INIT_DETAILS;
  if (code === "chat.generation") return CHAT_DETAILS;
  if (code === "embed.native") return EMBED_DETAILS;
  if (code === "unknown") return UNKNOWN_DETAILS;
  return UNKNOWN_DETAILS;
}

/**
 * Allowlisted signal patterns (order matters — first match wins).
 * Captured token is normalized; never the full message.
 * Patterns must NOT capture paths/URLs/user words.
 */
export const SIGNAL_PATTERNS: readonly {
  re: RegExp;
  /** Fixed token, or null to use the matched text (trimmed/sliced). */
  token: string | null;
}[] = [
  { re: /\bENOSPC\b/i, token: "ENOSPC" },
  { re: /\bEACCES\b/i, token: "EACCES" },
  { re: /\bENOENT\b/i, token: "ENOENT" },
  { re: /\bENOMEM\b/i, token: "ENOMEM" },
  { re: /\bEIO\b/i, token: "EIO" },
  { re: /\bEPERM\b/i, token: "EPERM" },
  { re: /segmentation\s+fault/i, token: "segmentation fault" },
  { re: /out\s+of\s+memory/i, token: "out of memory" },
  { re: /file\s+not\s+found/i, token: "file not found" },
  { re: /Unable\s+to\s+map/i, token: "Unable to map" },
  { re: /\bggml_[A-Za-z0-9_]+/i, token: null }, // use match → normalized ggml_*
  { re: /CUDA\s+error/i, token: "CUDA error" },
  { re: /init\s+failed/i, token: "init failed" },
  { re: /no\s+space\s+left/i, token: "ENOSPC" },
  { re: /context\s+overflow|ctx\s+overflow|n_ctx/i, token: "ctx overflow" },
  { re: /permission\s+denied/i, token: "EACCES" },
];

/**
 * Charset allowed in a final signal token.
 * Design §4: `[A-Za-z0-9_ .-]`. `*` is not in the charset (`ggml_*` is a fixed token).
 */
export const SIGNAL_CHARSET_RE = /^[A-Za-z0-9_ .-]+$/;

/** Safe release-version format (same contract as the Worker). */
export const APP_VERSION_RE = /^\d+(\.\d+){1,3}[a-z0-9.-]*$/;
