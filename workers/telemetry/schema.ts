/**
 * Pure Worker helpers — no Cloudflare bindings.
 * Used by workers/telemetry/index.ts and scripts/harnesses/telemetryWorkerHarness.mjs.
 */

export const BODY_LIMIT = 4 * 1024;
export const GLOBAL_QUOTA = 50;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const LEASE_MS = 5 * 60 * 1000;
export const SIGNAL_MAX = 80;
/** Design §4: charset is [A-Za-z0-9_ .-]. `*` is not allowed (ggml_* is a fixed token). */
export const SIGNAL_CHARSET = /^[A-Za-z0-9_ .-]+$/;
export const GGML_SIGNAL_RE = /^ggml_[A-Za-z0-9_]+$/;
export const GGML_SIGNAL_TOKEN = "ggml_*";
/** Safe release-version format (inert in Markdown issue bodies). */
export const APP_VERSION_RE = /^\d+(\.\d+){1,3}[a-z0-9.-]*$/;
export const GITHUB_SEARCH_TIMEOUT_MS = 8_000;
export const IP_MAP_MAX = 2048;
/** Design §7 canonical signature fields — `signal` is intentionally absent. */
export const SIGNATURE_KEYS = [
  "code",
  "detail",
  "appVersion",
  "deviceBucket",
  "modelCategory",
  "dateBucket",
] as const;

export const REASON_CODES = new Set([
  "engine.init",
  "chat.generation",
  "embed.native",
  "web.fetch",
  "web.search",
  "unknown",
]);

export const WEB_DETAILS = new Set([
  "http_403",
  "http_404",
  "http_5xx",
  "dns",
  "tls",
  "timeout",
  "oom",
  "payload_too_large",
  "unknown",
]);
export const ENGINE_INIT_DETAILS = new Set([
  "oom",
  "disk_full",
  "model_corrupt",
  "model_missing",
  "init_timeout",
  "native_crash",
  "unknown",
]);
export const CHAT_DETAILS = new Set([
  "oom",
  "native_crash",
  "ctx_overflow",
  "stop_aborted",
  "unknown",
]);
export const EMBED_DETAILS = new Set([
  "oom",
  "model_corrupt",
  "native_crash",
  "gate_aborted",
  "unknown",
]);

export const DEVICE_BUCKETS = new Set(["low", "mid", "high"]);
export const MEMORY_CLASSES = new Set(["lt-4gb", "4-6gb", "ge-6gb", "unknown"]);
export const MODEL_CATEGORIES = new Set(["dense.2b", "dense.4b", "moe", "unknown"]);
export const PHASES = new Set(["download", "load", "turn", "embed", "flush"]);

export const SIGNAL_FIXED = new Set([
  "ENOSPC",
  "EACCES",
  "ENOENT",
  "ENOMEM",
  "EIO",
  "EPERM",
  "segmentation fault",
  "out of memory",
  "file not found",
  "Unable to map",
  "ggml_*",
  "CUDA error",
  "init failed",
  "ctx overflow",
]);

export const TOP_KEYS = new Set([
  "v",
  "app",
  "appVersion",
  "platform",
  "deviceBucket",
  "osMajor",
  "error",
  "context",
  "dateBucket",
  "manual",
]);
export const ERROR_KEYS = new Set(["code", "detail", "signal"]);
export const CONTEXT_KEYS = new Set([
  "modelCategory",
  "memoryClass",
  "hadWebTools",
  "phase",
  "attempt",
  "chunks",
]);

/** `unknown` has its own allowlist — never inherits engine-init details. */
export const UNKNOWN_DETAILS = new Set(["unknown"]);

export function detailsForCode(code: string): Set<string> {
  if (code === "web.fetch" || code === "web.search") return WEB_DETAILS;
  if (code === "engine.init") return ENGINE_INIT_DETAILS;
  if (code === "chat.generation") return CHAT_DETAILS;
  if (code === "embed.native") return EMBED_DETAILS;
  if (code === "unknown") return UNKNOWN_DETAILS;
  return UNKNOWN_DETAILS;
}

export function isValidDateBucket(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidAppVersion(s: string): boolean {
  return typeof s === "string" && s.length > 0 && s.length <= 32 && APP_VERSION_RE.test(s);
}

/**
 * Normalize a claimed signal. Any `ggml_<id>` collapses to the fixed `ggml_*`
 * token. Charset `*` is rejected except as that exact token.
 * Returns the accepted token, or null if invalid.
 */
export function normalizeSignal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > SIGNAL_MAX) return null;
  if (value === GGML_SIGNAL_TOKEN) return GGML_SIGNAL_TOKEN;
  if (GGML_SIGNAL_RE.test(value)) return GGML_SIGNAL_TOKEN;
  if (!SIGNAL_CHARSET.test(value)) return null;
  if (SIGNAL_FIXED.has(value)) return value;
  return null;
}

export function acceptSignal(value: unknown): boolean {
  return normalizeSignal(value) !== null;
}

/** Strict schema validation. Returns error string or null if ok. */
export function validateReport(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "body must be object";
  }
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!TOP_KEYS.has(k)) return `unknown key: ${k}`;
  }
  if (o.v !== 1) return "v must be 1";
  if (o.app !== "kalsa") return "app must be kalsa";
  if (o.platform !== "android") return "platform must be android";
  if (typeof o.appVersion !== "string" || !isValidAppVersion(o.appVersion)) {
    return "appVersion invalid";
  }
  if (typeof o.deviceBucket !== "string" || !DEVICE_BUCKETS.has(o.deviceBucket)) {
    return "deviceBucket invalid";
  }
  if (typeof o.osMajor !== "string" || !/^\d+$/.test(o.osMajor) || o.osMajor.length > 8) {
    return "osMajor invalid";
  }
  if (typeof o.dateBucket !== "string" || !isValidDateBucket(o.dateBucket)) {
    return "dateBucket invalid";
  }
  if (typeof o.manual !== "boolean") return "manual must be boolean";

  if (!o.error || typeof o.error !== "object" || Array.isArray(o.error)) {
    return "error must be object";
  }
  const err = o.error as Record<string, unknown>;
  for (const k of Object.keys(err)) {
    if (!ERROR_KEYS.has(k)) return `unknown error key: ${k}`;
  }
  if (typeof err.code !== "string" || !REASON_CODES.has(err.code)) {
    return "error.code invalid";
  }
  if (err.detail !== undefined) {
    if (typeof err.detail !== "string" || !detailsForCode(err.code).has(err.detail)) {
      return "error.detail invalid";
    }
  }
  if (err.signal !== undefined) {
    const normalized = normalizeSignal(err.signal);
    if (normalized === null) return "error.signal invalid";
    err.signal = normalized;
  }

  if (!o.context || typeof o.context !== "object" || Array.isArray(o.context)) {
    return "context must be object";
  }
  const ctx = o.context as Record<string, unknown>;
  for (const k of Object.keys(ctx)) {
    if (!CONTEXT_KEYS.has(k)) return `unknown context key: ${k}`;
  }
  if (ctx.modelCategory !== undefined) {
    if (typeof ctx.modelCategory !== "string" || !MODEL_CATEGORIES.has(ctx.modelCategory)) {
      return "context.modelCategory invalid";
    }
  }
  if (ctx.memoryClass !== undefined) {
    if (typeof ctx.memoryClass !== "string" || !MEMORY_CLASSES.has(ctx.memoryClass)) {
      return "context.memoryClass invalid";
    }
  }
  if (ctx.hadWebTools !== undefined && typeof ctx.hadWebTools !== "boolean") {
    return "context.hadWebTools invalid";
  }
  if (ctx.phase !== undefined) {
    if (typeof ctx.phase !== "string" || !PHASES.has(ctx.phase)) {
      return "context.phase invalid";
    }
  }
  if (ctx.attempt !== undefined) {
    if (
      typeof ctx.attempt !== "number" ||
      !Number.isInteger(ctx.attempt) ||
      ctx.attempt < 1 ||
      ctx.attempt > 5
    ) {
      return "context.attempt invalid";
    }
  }
  if (ctx.chunks !== undefined) {
    if (err.code !== "embed.native") {
      return "context.chunks only allowed for embed.native";
    }
    if (
      typeof ctx.chunks !== "number" ||
      !Number.isInteger(ctx.chunks) ||
      ctx.chunks < 0 ||
      ctx.chunks > 100_000
    ) {
      return "context.chunks invalid";
    }
  }
  return null;
}

export type GithubSearchOutcome = "found" | "not_found" | "error";

export function classifyGithubSearchResponse(opts: {
  ok: boolean;
  status?: number;
  totalCount?: number;
  threw?: boolean;
}): GithubSearchOutcome {
  if (opts.threw) return "error";
  if (!opts.ok) return "error";
  const n = opts.totalCount;
  if (typeof n !== "number" || !Number.isInteger(n) || !Number.isFinite(n) || n < 0) {
    return "error";
  }
  return n > 0 ? "found" : "not_found";
}

/**
 * After two GitHub searches: create only on two consecutive not_found.
 * Any error → release lease, do not create.
 */
export function decideCreateIssue(
  first: GithubSearchOutcome,
  second: GithubSearchOutcome | null,
): "create" | "mark_created" | "release" {
  if (first === "error") return "release";
  if (first === "found") return "mark_created";
  if (second == null) return "release";
  if (second === "error") return "release";
  if (second === "found") return "mark_created";
  return "create";
}

export type BufferEntry = {
  reportId: string;
  sig: string;
  report: unknown;
  state: "pending" | "creating" | "created";
  reviewAck: boolean;
  leaseUntil: number;
  leaseToken: number;
  createdAt: number;
};

export type BufferState = {
  entries: BufferEntry[];
  hourBucket: number;
  hourCount: number;
  nextLeaseToken: number;
};

export function emptyBufferState(): BufferState {
  return {
    entries: [],
    hourBucket: 0,
    hourCount: 0,
    nextLeaseToken: 1,
  };
}

/** Pure lease acquisition against an in-memory snapshot (CAS input). */
export function tryAcquireLease(
  st: BufferState,
  reportId: string,
  now: number,
  leaseMs: number = LEASE_MS,
): { ok: true; token: number; state: BufferState } | { ok: false; reason: string } {
  const entry = st.entries.find((e) => e.reportId === reportId);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.state === "created") return { ok: false, reason: "already_created" };
  if (entry.state === "creating" && entry.leaseUntil > now) {
    return { ok: false, reason: "leased" };
  }
  const token = st.nextLeaseToken;
  const next: BufferState = {
    ...st,
    nextLeaseToken: token + 1,
    entries: st.entries.map((e) =>
      e.reportId === reportId
        ? {
            ...e,
            state: "creating",
            leaseUntil: now + leaseMs,
            leaseToken: token,
            reviewAck: false,
          }
        : e,
    ),
  };
  return { ok: true, token, state: next };
}

/**
 * Pure final transition — only the holder of `expectedToken` may mutate,
 * and only while the lease is still unexpired.
 */
export function applyLeaseTransition(
  st: BufferState,
  reportId: string,
  expectedToken: number,
  nextState: "created" | "pending",
  now?: number,
): { ok: true; state: BufferState } | { ok: false; reason: string } {
  const entry = st.entries.find((e) => e.reportId === reportId);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.leaseToken !== expectedToken) return { ok: false, reason: "stale_token" };
  if (entry.state !== "creating") return { ok: false, reason: "not_leased" };
  if (now !== undefined && entry.leaseUntil <= now) {
    return { ok: false, reason: "expired" };
  }
  const next: BufferState = {
    ...st,
    entries: st.entries.map((e) =>
      e.reportId === reportId
        ? {
            ...e,
            state: nextState,
            leaseUntil: 0,
            leaseToken: nextState === "created" ? e.leaseToken : 0,
          }
        : e,
    ),
  };
  return { ok: true, state: next };
}

export function validFlushAuth(flushToken: string | undefined, authHeader: string | null):
  | { ok: true }
  | { ok: false; status: 503 | 401 } {
  if (!flushToken) return { ok: false, status: 503 };
  if (authHeader !== `Bearer ${flushToken}`) return { ok: false, status: 401 };
  return { ok: true };
}

export function validAdminAuth(adminToken: string | undefined, authHeader: string | null):
  | { ok: true }
  | { ok: false; status: 503 | 401 } {
  if (!adminToken) return { ok: false, status: 503 };
  if (authHeader !== `Bearer ${adminToken}`) return { ok: false, status: 401 };
  return { ok: true };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Canonical §7 signature input. `signal` is never included. */
export function canonicalSignatureInput(report: Record<string, unknown>): Record<string, string> {
  const err = (report.error ?? {}) as Record<string, unknown>;
  const ctx = (report.context ?? {}) as Record<string, unknown>;
  return {
    code: String(err.code ?? ""),
    detail: String(err.detail ?? ""),
    appVersion: String(report.appVersion ?? ""),
    deviceBucket: String(report.deviceBucket ?? ""),
    modelCategory: String(ctx.modelCategory ?? ""),
    dateBucket: String(report.dateBucket ?? ""),
  };
}

export function signatureFields(report: Record<string, unknown>): string {
  return stableStringify(canonicalSignatureInput(report));
}

/** HTTP status for a rejected append. Quota must be 429 so clients back off. */
export function reportRejectStatus(reason: string | undefined): number {
  return reason === "quota" ? 429 : 200;
}

export function contentLengthExceeds(header: string | null, limit: number): boolean {
  if (header == null || header === "") return false;
  const n = Number(header);
  if (!Number.isFinite(n) || n < 0) return false;
  return n > limit;
}

export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Best-effort in-memory IP map: drop expired hits, evict oldest keys if over cap. */
export function pruneIpMap(
  ipHits: Map<string, number[]>,
  now: number,
  windowMs: number,
  maxKeys: number = IP_MAP_MAX,
): void {
  for (const [ip, hits] of ipHits) {
    const kept = hits.filter((t) => now - t < windowMs);
    if (kept.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, kept);
  }
  if (ipHits.size <= maxKeys) return;
  const overflow = ipHits.size - maxKeys;
  let i = 0;
  for (const key of ipHits.keys()) {
    if (i >= overflow) break;
    ipHits.delete(key);
    i += 1;
  }
}

/** Strip Markdown / URL metacharacters so published issue text stays inert. */
export function escapeIssueText(s: string): string {
  return s.replace(/[`*_\[\]()<>!#|\\]/g, "").replace(/https?:\/\//gi, "").trim();
}

export type IssueProjection = {
  code: string;
  detail: string;
  signal: string;
  appVersion: string;
  deviceBucket: string;
  osMajor: string;
  modelCategory: string;
  memoryClass: string;
  hadWebTools: string;
  phase: string;
  attempt: string;
  chunks: string;
  dateBucket: string;
  manual: string;
};

/** Allowlisted projection of a validated report for public issue bodies. */
export function projectIssueFields(report: unknown): IssueProjection {
  const o = report && typeof report === "object" ? (report as Record<string, unknown>) : {};
  const err = o.error && typeof o.error === "object" ? (o.error as Record<string, unknown>) : {};
  const ctx = o.context && typeof o.context === "object" ? (o.context as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? escapeIssueText(v) : "");
  const num = (v: unknown): string =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  const bool = (v: unknown): string => (typeof v === "boolean" ? String(v) : "");
  return {
    code: str(err.code),
    detail: str(err.detail),
    signal: str(err.signal),
    appVersion: str(o.appVersion),
    deviceBucket: str(o.deviceBucket),
    osMajor: str(o.osMajor),
    modelCategory: str(ctx.modelCategory),
    memoryClass: str(ctx.memoryClass),
    hadWebTools: bool(ctx.hadWebTools),
    phase: str(ctx.phase),
    attempt: num(ctx.attempt),
    chunks: num(ctx.chunks),
    dateBucket: str(o.dateBucket),
    manual: bool(o.manual),
  };
}

/** Public GitHub issue body. Never includes `_reportId` or raw JSON. */
export function buildIssueBody(sig: string, report: unknown): string {
  const p = projectIssueFields(report);
  const lines = [
    `Telemetry signature: ${escapeIssueText(sig)}`,
    "",
    `code: ${p.code}`,
    `detail: ${p.detail}`,
    `signal: ${p.signal}`,
    `appVersion: ${p.appVersion}`,
    `deviceBucket: ${p.deviceBucket}`,
    `osMajor: ${p.osMajor}`,
    `modelCategory: ${p.modelCategory}`,
    `memoryClass: ${p.memoryClass}`,
    `hadWebTools: ${p.hadWebTools}`,
    `phase: ${p.phase}`,
    `attempt: ${p.attempt}`,
    `chunks: ${p.chunks}`,
    `dateBucket: ${p.dateBucket}`,
    `manual: ${p.manual}`,
  ];
  return lines.join("\n");
}

export function issueTitleFromProjection(p: IssueProjection): string {
  const code = p.code || "unknown";
  const detail = p.detail ? ` / ${p.detail}` : "";
  return `[telemetry] ${code}${detail}`.slice(0, 200);
}
