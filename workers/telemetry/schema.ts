/**
 * Pure Worker helpers — no Cloudflare bindings.
 * Used by workers/telemetry/index.ts and scripts/telemetryWorkerHarness.mjs.
 */

export const BODY_LIMIT = 4 * 1024;
export const GLOBAL_QUOTA = 50;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const LEASE_MS = 5 * 60 * 1000;
export const SIGNAL_MAX = 80;
export const SIGNAL_CHARSET = /^[A-Za-z0-9_ .*\-]+$/;

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

export function detailsForCode(code: string): Set<string> {
  if (code === "web.fetch" || code === "web.search") return WEB_DETAILS;
  if (code === "engine.init") return ENGINE_INIT_DETAILS;
  if (code === "chat.generation") return CHAT_DETAILS;
  if (code === "embed.native") return EMBED_DETAILS;
  return ENGINE_INIT_DETAILS;
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

export function acceptSignal(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > SIGNAL_MAX) return false;
  if (!SIGNAL_CHARSET.test(value)) return false;
  if (SIGNAL_FIXED.has(value)) return true;
  if (value === "ggml_*" || /^ggml_[A-Za-z0-9_]+$/.test(value)) return true;
  return false;
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
  if (typeof o.appVersion !== "string" || o.appVersion.length === 0 || o.appVersion.length > 32) {
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
    if (!acceptSignal(err.signal)) return "error.signal invalid";
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
  return (opts.totalCount ?? 0) > 0 ? "found" : "not_found";
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

/** Pure final transition — only the holder of `expectedToken` may mutate. */
export function applyLeaseTransition(
  st: BufferState,
  reportId: string,
  expectedToken: number,
  nextState: "created" | "pending",
): { ok: true; state: BufferState } | { ok: false; reason: string } {
  const entry = st.entries.find((e) => e.reportId === reportId);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.leaseToken !== expectedToken) return { ok: false, reason: "stale_token" };
  if (entry.state !== "creating") return { ok: false, reason: "not_leased" };
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
