/**
 * Pure telemetry helpers — Node-harness safe (no RN, no AsyncStorage, no fetch).
 * Design: docs/architecture/TELEMETRY_OPTIN.md v14 FINAL + diag-addendum.
 */

import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEAD_CAP,
  DEAD_TTL_MS,
  DEVICE_BUCKETS,
  MEMORY_CLASSES,
  MODEL_CATEGORIES,
  PHASES,
  QUEUE_CAP,
  REASON_CODES,
  RETRY_CEILING,
  APP_VERSION_RE,
  SIGNAL_CHARSET_RE,
  SIGNAL_MAX_LEN,
  SIGNAL_PATTERNS,
  TELEMETRY_SCHEMA_V,
  detailsForCode,
  type DetailValue,
  type DeviceBucket,
  type MemoryClass,
  type ModelCategory,
  type Phase,
  type ReasonCode,
} from "./config";

// ── FNV-1a 64 (same constants as embeddingPure.hashChunkContent) ────────────

/** FNV-1a 64-bit as 16-char lowercase hex (UTF-16 code units, RN/JS string). */
export function fnv1a64Hex(text: string): string {
  const s = typeof text === "string" ? text : "";
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = 0xffffffffffffffffn;
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

// ── Bucket mappings (ramTier from deviceProfile/contextProfile) ─────────────

export type RamTierLike = "low" | "mid" | "high";

/** deviceBucket is 1:1 with ramTier (deterministic, harness-tested). */
export function deviceBucketFromRamTier(
  tier: RamTierLike | null | undefined,
): DeviceBucket {
  if (tier === "low" || tier === "mid" || tier === "high") return tier;
  return "low";
}

/**
 * memoryClass from totalMemoryBytes (independent of ramTier thresholds so
 * 4–6GB devices are distinguishable from lt-4gb; ramTier mid starts at 6GB).
 * Buckets: lt-4gb | 4-6gb | ge-6gb | unknown.
 */
export function memoryClassFromBytes(
  totalMemoryBytes: number | null | undefined,
): MemoryClass {
  if (
    typeof totalMemoryBytes !== "number" ||
    !Number.isFinite(totalMemoryBytes) ||
    totalMemoryBytes <= 0
  ) {
    return "unknown";
  }
  const GB = 1_000_000_000;
  if (totalMemoryBytes < 4 * GB) return "lt-4gb";
  if (totalMemoryBytes < 6 * GB) return "4-6gb";
  return "ge-6gb";
}

/**
 * modelCategory from model id / flags. Never the full model id.
 * Heuristic on known free-tier ids; unknown otherwise.
 */
export function modelCategoryFromId(
  modelId: string | null | undefined,
  opts?: { moe?: boolean },
): ModelCategory {
  if (opts?.moe) return "moe";
  if (typeof modelId !== "string" || !modelId) return "unknown";
  const id = modelId.toLowerCase();
  if (id.includes("moe") || id.includes("mixtral") || id.includes("a0.")) {
    return "moe";
  }
  if (
    /(^|[-_.])2b([\-_.]|$)/.test(id) ||
    id.includes("1.5b") ||
    id.includes("1b")
  ) {
    return "dense.2b";
  }
  if (
    /(^|[-_.])4b([\-_.]|$)/.test(id) ||
    id.includes("3.5-4b") ||
    id.includes("3b")
  ) {
    return "dense.4b";
  }
  return "unknown";
}

/**
 * Calendar-valid UTC dateBucket (same invariant as the Worker).
 * Rejects 2026-02-29 / 2026-13-01 / non-YYYY-MM-DD.
 */
export function isValidDateBucket(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d)
  ) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function dateBucketUtc(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function osMajorFromVersion(
  osVersion: string | null | undefined,
): string {
  if (typeof osVersion !== "string" || !osVersion) return "0";
  const m = osVersion.trim().match(/^(\d+)/);
  return m ? m[1]! : "0";
}

// ── Signal extraction (diag-addendum) ────────────────────────────────────────

/**
 * Extract a NORMALIZED signal token from a real error message via allowlist
 * regexes only. Never returns free text. No match → undefined (omit field).
 *
 * Rules:
 * - First matching SIGNAL_PATTERNS entry wins.
 * - ggml_* matches keep the matched identifier, truncated to SIGNAL_MAX_LEN.
 * - Final token must match SIGNAL_CHARSET_RE and length ≤ 80.
 * - Messages that are primarily URL/path with no allowlisted token → omit.
 */
export function extractSignal(rawMessage: unknown): string | undefined {
  try {
    if (rawMessage == null) return undefined;
    const msg =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage instanceof Error
          ? rawMessage.message
          : String(rawMessage);
    if (!msg || typeof msg !== "string") return undefined;

    // Reject if the whole message is basically a URL/path with no other signal
    // — still allow ENOSPC etc. if present alongside a path.
    for (const { re, token } of SIGNAL_PATTERNS) {
      const m = msg.match(re);
      if (!m) continue;
      let out: string;
      if (token != null) {
        out = token;
      } else {
        // Use matched text; normalize ggml_Foo → keep as matched (case preserved from source match)
        const matched = m[0] ?? "";
        // For ggml_*: collapse to "ggml_*" family marker if long, else keep short id
        if (/^ggml_/i.test(matched)) {
          // Keep the ggml_ prefix + identifier, strip anything unsafe
          out = matched.replace(/[^A-Za-z0-9_]/g, "").slice(0, SIGNAL_MAX_LEN);
          // Represent family as ggml_<name> — if empty after strip, use ggml_*
          if (!/^ggml_/i.test(out)) out = "ggml_";
          // Design harness expects "ggml_*" for ggml_opencl style
          out = "ggml_*";
        } else {
          out = matched.slice(0, SIGNAL_MAX_LEN);
        }
      }
      out = out.trim().slice(0, SIGNAL_MAX_LEN);
      // ggml_* is a fixed token; charset excludes `*` so skip that check.
      if (!out) continue;
      if (out !== "ggml_*" && !SIGNAL_CHARSET_RE.test(out)) continue;
      return out;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate a signal already claimed by a caller (Worker-side / sanitize).
 * Returns the signal if conformant, else undefined.
 */
export function acceptSignal(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().slice(0, SIGNAL_MAX_LEN);
  if (!s || s.length > SIGNAL_MAX_LEN) return undefined;
  // ggml_* is a fixed token; any ggml_<id> collapses to it. Checked before
  // charset so the `*` in the token is not rejected.
  if (s === "ggml_*") return s;
  if (/^ggml_[A-Za-z0-9_]+$/.test(s)) return "ggml_*";
  if (!SIGNAL_CHARSET_RE.test(s)) return undefined;
  for (const { re, token } of SIGNAL_PATTERNS) {
    if (token != null && token === s) return s;
    if (token == null && re.test(s)) return s;
  }
  const FIXED = new Set(
    SIGNAL_PATTERNS.map((p) => p.token).filter((t): t is string => t != null),
  );
  if (FIXED.has(s)) return s;
  return undefined;
}

// ── Report types ────────────────────────────────────────────────────────────

export type TelemetryErrorField = {
  code: ReasonCode;
  detail?: DetailValue;
  signal?: string;
};

export type TelemetryContext = {
  modelCategory?: ModelCategory;
  memoryClass?: MemoryClass;
  hadWebTools?: boolean;
  phase?: Phase;
  attempt?: number;
  chunks?: number;
};

export type TelemetryReport = {
  v: 1;
  app: "kalsa";
  appVersion: string;
  platform: "android";
  deviceBucket: DeviceBucket;
  osMajor: string;
  error: TelemetryErrorField;
  context: TelemetryContext;
  dateBucket: string;
  manual: boolean;
};

export type SanitizeInput = {
  code: ReasonCode | string;
  detail?: string;
  /** Raw message ONLY for extractSignal — never forwarded as text. */
  rawMessage?: string;
  /** Pre-extracted signal (still re-validated). */
  signal?: string;
  appVersion?: string;
  deviceBucket?: DeviceBucket | string;
  osMajor?: string;
  modelCategory?: ModelCategory | string;
  memoryClass?: MemoryClass | string;
  hadWebTools?: boolean;
  phase?: Phase | string;
  attempt?: number;
  chunks?: number;
  dateBucket?: string;
  manual?: boolean;
};

function isReasonCode(v: unknown): v is ReasonCode {
  return (
    typeof v === "string" && (REASON_CODES as readonly string[]).includes(v)
  );
}

function isDeviceBucket(v: unknown): v is DeviceBucket {
  return (
    typeof v === "string" && (DEVICE_BUCKETS as readonly string[]).includes(v)
  );
}

function isMemoryClass(v: unknown): v is MemoryClass {
  return (
    typeof v === "string" && (MEMORY_CLASSES as readonly string[]).includes(v)
  );
}

function isModelCategory(v: unknown): v is ModelCategory {
  return (
    typeof v === "string" && (MODEL_CATEGORIES as readonly string[]).includes(v)
  );
}

function isPhase(v: unknown): v is Phase {
  return typeof v === "string" && (PHASES as readonly string[]).includes(v);
}

/**
 * Allowlist-only sanitizer. NEVER accepts free text, stacks, URLs, paths.
 * detail is accepted ONLY if in the per-code enum; otherwise omitted.
 * signal is accepted ONLY via extractSignal / acceptSignal.
 * Does NOT reuse sanitizeToolErrorMessage (which parks/preserves URLs).
 */
export function sanitizeReport(input: SanitizeInput): TelemetryReport | null {
  try {
    if (!input || typeof input !== "object") return null;
    const code = isReasonCode(input.code) ? input.code : "unknown";

    let detail: DetailValue | undefined;
    if (typeof input.detail === "string") {
      const allowed = detailsForCode(code);
      if ((allowed as readonly string[]).includes(input.detail)) {
        detail = input.detail as DetailValue;
      }
      // else: omit (including any sanitizeToolErrorMessage-style URL text)
    }

    // signal: prefer explicit (re-validated), else extract from rawMessage
    let signal: string | undefined;
    if (typeof input.signal === "string") {
      signal = acceptSignal(input.signal);
    }
    if (signal === undefined && typeof input.rawMessage === "string") {
      signal = extractSignal(input.rawMessage);
    }

    const rawVersion =
      typeof input.appVersion === "string" ? input.appVersion.slice(0, 32) : "";
    const appVersion = APP_VERSION_RE.test(rawVersion) ? rawVersion : "0.0.0";

    const deviceBucket: DeviceBucket = isDeviceBucket(input.deviceBucket)
      ? input.deviceBucket
      : "low";

    const osMajor =
      typeof input.osMajor === "string" && /^\d+$/.test(input.osMajor)
        ? input.osMajor.slice(0, 8)
        : "0";

    const context: TelemetryContext = {};
    if (isModelCategory(input.modelCategory)) {
      context.modelCategory = input.modelCategory;
    }
    if (isMemoryClass(input.memoryClass)) {
      context.memoryClass = input.memoryClass;
    }
    if (typeof input.hadWebTools === "boolean") {
      context.hadWebTools = input.hadWebTools;
    }
    if (isPhase(input.phase)) {
      context.phase = input.phase;
    }
    if (
      typeof input.attempt === "number" &&
      Number.isInteger(input.attempt) &&
      input.attempt >= 1 &&
      input.attempt <= 5
    ) {
      context.attempt = input.attempt;
    }
    if (
      code === "embed.native" &&
      typeof input.chunks === "number" &&
      Number.isInteger(input.chunks) &&
      input.chunks >= 0 &&
      input.chunks <= 100_000
    ) {
      context.chunks = input.chunks;
    }

    const dateBucket =
      typeof input.dateBucket === "string" && isValidDateBucket(input.dateBucket)
        ? input.dateBucket
        : dateBucketUtc();

    const error: TelemetryErrorField = { code };
    if (detail !== undefined) error.detail = detail;
    if (signal !== undefined) error.signal = signal;

    const report: TelemetryReport = {
      v: TELEMETRY_SCHEMA_V,
      app: "kalsa",
      appVersion,
      platform: "android",
      deviceBucket,
      osMajor,
      error,
      context,
      dateBucket,
      manual: input.manual === true,
    };
    return report;
  } catch {
    return null;
  }
}

/** Local fingerprint for best-effort same-run dedupe (NOT the server SHA-256). */
export function localFingerprint(report: TelemetryReport): string {
  const parts = [
    report.error.code,
    report.error.detail ?? "",
    report.error.signal ?? "",
    report.appVersion,
    report.deviceBucket,
    report.context.modelCategory ?? "",
    report.dateBucket,
  ];
  return fnv1a64Hex(parts.join("|"));
}

// ── Envelope / journal ──────────────────────────────────────────────────────

export type QueueItemState =
  | "queued"
  | "sending"
  | "dropped"
  | "dead"
  | "accepted";

export type QueueItem = {
  report: TelemetryReport;
  state: QueueItemState;
  generation: number;
  transitionEpoch: number;
  retryCount: number;
  nextRetryAt: number;
  leaseUntil: number;
  deadExpiresAt: number;
  reviewAck: boolean;
  /** Stable id for in-process tracking (not sent to Worker). */
  id: string;
};

export type TelemetryEnvelope = {
  v: 1;
  enabled: boolean;
  generation: number;
  transitionEpoch: number;
  queue: QueueItem[];
  dead: QueueItem[];
  /** Monotonic write counter for the dual-slot journal. */
  seq: number;
  /** Integrity hash of the payload (excluding itself). */
  integrity: string;
};

export type Tombstone = {
  v: 1;
  optedOutAt: string;
  /** Monotonic journal seq (A/B slots). Legacy single-key tombs omit this. */
  seq: number;
  integrity: string;
};

/** Canonical JSON for integrity (sorted keys, no whitespace). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function envelopePayloadForHash(
  env: Omit<TelemetryEnvelope, "integrity">,
): string {
  return stableStringify(env);
}

export function computeIntegrity(
  env: Omit<TelemetryEnvelope, "integrity">,
): string {
  return fnv1a64Hex(envelopePayloadForHash(env));
}

export function withIntegrity(
  env: Omit<TelemetryEnvelope, "integrity">,
): TelemetryEnvelope {
  return { ...env, integrity: computeIntegrity(env) };
}

export function verifyEnvelopeIntegrity(env: TelemetryEnvelope): boolean {
  if (!env || typeof env !== "object") return false;
  if (env.v !== 1) return false;
  if (typeof env.integrity !== "string" || env.integrity.length !== 16) {
    return false;
  }
  const { integrity: _i, ...rest } = env;
  return computeIntegrity(rest) === env.integrity;
}

export function emptyEnvelope(
  opts?: Partial<
    Pick<
      TelemetryEnvelope,
      "enabled" | "generation" | "transitionEpoch" | "seq"
    >
  >,
): TelemetryEnvelope {
  return withIntegrity({
    v: 1,
    enabled: opts?.enabled === true,
    generation: typeof opts?.generation === "number" ? opts.generation : 0,
    transitionEpoch:
      typeof opts?.transitionEpoch === "number" ? opts.transitionEpoch : 0,
    queue: [],
    dead: [],
    seq: typeof opts?.seq === "number" ? opts.seq : 0,
  });
}

export function computeTombstoneIntegrity(
  optedOutAt: string,
  seq: number = 0,
): string {
  return fnv1a64Hex(stableStringify({ v: 1, optedOutAt, seq }));
}

export function makeTombstone(
  nowMs: number = Date.now(),
  seq: number = 1,
): Tombstone {
  const optedOutAt = new Date(nowMs).toISOString();
  const safeSeq = Number.isInteger(seq) && seq > 0 ? seq : 1;
  return {
    v: 1,
    optedOutAt,
    seq: safeSeq,
    integrity: computeTombstoneIntegrity(optedOutAt, safeSeq),
  };
}

export function verifyTombstone(raw: unknown): Tombstone | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Tombstone;
  if (t.v !== 1) return null;
  if (typeof t.optedOutAt !== "string" || !t.optedOutAt) return null;
  if (typeof t.integrity !== "string") return null;
  // Journal tombs carry seq. Legacy single-key tombs omit seq (hash as 0).
  const seq =
    typeof t.seq === "number" && Number.isInteger(t.seq) && t.seq >= 0
      ? t.seq
      : 0;
  if (computeTombstoneIntegrity(t.optedOutAt, seq) === t.integrity) {
    return { v: 1, optedOutAt: t.optedOutAt, seq, integrity: t.integrity };
  }
  // Pre-journal tombs hashed without seq field.
  if (seq === 0) {
    const legacy = fnv1a64Hex(stableStringify({ v: 1, optedOutAt: t.optedOutAt }));
    if (legacy === t.integrity) {
      return { v: 1, optedOutAt: t.optedOutAt, seq: 0, integrity: t.integrity };
    }
  }
  return null;
}

/**
 * Select tombstone slot: ALWAYS highest valid-seq among hash-valid slots.
 * Pointer is a hint only. Both torn/absent → null (caller fail-closed OFF).
 */
export function selectTombstoneSlot(
  slotA: Tombstone | null,
  slotB: Tombstone | null,
  _pointerHint: "A" | "B" | null,
): { slot: "A" | "B"; tombstone: Tombstone } | null {
  const aOk = slotA && verifyTombstone(slotA) ? slotA : null;
  const bOk = slotB && verifyTombstone(slotB) ? slotB : null;
  if (!aOk && !bOk) return null;
  if (aOk && !bOk) return { slot: "A", tombstone: aOk };
  if (!aOk && bOk) return { slot: "B", tombstone: bOk };
  if (aOk!.seq >= bOk!.seq) return { slot: "A", tombstone: aOk! };
  return { slot: "B", tombstone: bOk! };
}

/**
 * Select journal slot: ALWAYS highest valid-seq among hash-valid slots.
 * Pointer is only a hint (never authoritative).
 * Both corrupt → null (caller fail-closed resets).
 */
export function selectJournalSlot(
  slotA: TelemetryEnvelope | null,
  slotB: TelemetryEnvelope | null,
  _pointerHint: "A" | "B" | null,
): { slot: "A" | "B"; envelope: TelemetryEnvelope } | null {
  const aOk = slotA && verifyEnvelopeIntegrity(slotA) ? slotA : null;
  const bOk = slotB && verifyEnvelopeIntegrity(slotB) ? slotB : null;
  if (!aOk && !bOk) return null;
  if (aOk && !bOk) return { slot: "A", envelope: aOk };
  if (!aOk && bOk) return { slot: "B", envelope: bOk };
  if (aOk!.seq >= bOk!.seq) return { slot: "A", envelope: aOk! };
  return { slot: "B", envelope: bOk! };
}

export function parseEnvelopeJson(
  raw: string | null | undefined,
): TelemetryEnvelope | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as TelemetryEnvelope;
    if (!verifyEnvelopeIntegrity(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Queue ops (pure) ────────────────────────────────────────────────────────

export function makeQueueItem(
  report: TelemetryReport,
  generation: number,
  transitionEpoch: number,
  id: string,
): QueueItem {
  return {
    report,
    state: "queued",
    generation,
    transitionEpoch,
    retryCount: 0,
    nextRetryAt: 0,
    leaseUntil: 0,
    deadExpiresAt: 0,
    reviewAck: false,
    id,
  };
}

/** Drop-oldest when over cap. */
export function enqueueCapped(
  queue: QueueItem[],
  item: QueueItem,
  cap: number = QUEUE_CAP,
): QueueItem[] {
  const next = [...queue, item];
  if (next.length <= cap) return next;
  return next.slice(next.length - cap);
}

/** Expunge dead entries past TTL; drop over cap (oldest first). */
export function expungeDead(
  dead: QueueItem[],
  nowMs: number,
  cap: number = DEAD_CAP,
  ttlMs: number = DEAD_TTL_MS,
): QueueItem[] {
  let next = dead.filter(
    (d) =>
      d.state === "dead" &&
      typeof d.deadExpiresAt === "number" &&
      d.deadExpiresAt > nowMs,
  );
  if (next.length > cap) {
    next = [...next]
      .sort((a, b) => a.deadExpiresAt - b.deadExpiresAt)
      .slice(next.length - cap);
  }
  return next;
}

/**
 * On load: recover sending leases that expired → requeue (unless epoch/gen stale —
 * caller applies barrier rules). Here we only flip lease-expired sending → queued.
 */
export function recoverExpiredLeases(
  queue: QueueItem[],
  nowMs: number,
): QueueItem[] {
  return queue.map((item) => {
    if (item.state !== "sending") return item;
    if (item.leaseUntil > nowMs) return item;
    return { ...item, state: "queued" as const, leaseUntil: 0 };
  });
}

/**
 * Drop items whose generation or transitionEpoch no longer matches live values.
 * Terminal — never requeue / dead-letter these.
 */
export function dropStaleEpochItems(
  queue: QueueItem[],
  generation: number,
  transitionEpoch: number,
): { kept: QueueItem[]; dropped: number } {
  const kept: QueueItem[] = [];
  let dropped = 0;
  for (const item of queue) {
    if (
      item.generation !== generation ||
      item.transitionEpoch !== transitionEpoch ||
      item.state === "dropped"
    ) {
      dropped += 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

export type ResponseClass =
  | "accepted"
  | "duplicate"
  | "definitive_drop" // 400/413/4xx non-429
  | "backoff" // 429
  | "requeue" // 5xx / timeout / network
  | "transition_drop"; // generation/epoch mismatch or abort(transition)

export function classifyHttpStatus(status: number): ResponseClass {
  if (status === 200 || status === 201 || status === 202 || status === 204) {
    return "accepted";
  }
  if (status === 429) return "backoff";
  if (status === 400 || status === 413) return "definitive_drop";
  if (status >= 400 && status < 500) return "definitive_drop";
  if (status >= 500) return "requeue";
  return "requeue";
}

/**
 * Apply finalizer rules for one item outcome.
 * generation/transitionEpoch mismatch → terminal drop of EVERY outcome.
 */
export function finalizeItemOutcome(opts: {
  item: QueueItem;
  liveGeneration: number;
  liveTransitionEpoch: number;
  enabled: boolean;
  responseClass: ResponseClass;
  nowMs: number;
  /** Server said duplicate (treat as accepted for client purposes). */
  duplicate?: boolean;
}): {
  action: "drop" | "requeue" | "dead" | "done";
  item: QueueItem | null;
  backoffMs?: number;
} {
  const {
    item,
    liveGeneration,
    liveTransitionEpoch,
    enabled,
    responseClass,
    nowMs,
  } = opts;

  if (
    item.generation !== liveGeneration ||
    item.transitionEpoch !== liveTransitionEpoch
  ) {
    return { action: "drop", item: null };
  }
  if (!enabled) {
    return { action: "drop", item: null };
  }
  if (responseClass === "transition_drop") {
    return {
      action: "drop",
      item: { ...item, state: "dropped" },
    };
  }
  if (
    responseClass === "accepted" ||
    opts.duplicate ||
    responseClass === "definitive_drop"
  ) {
    return { action: "done", item: null };
  }

  const retryCount = item.retryCount;
  if (retryCount >= RETRY_CEILING) {
    return {
      action: "dead",
      item: {
        ...item,
        state: "dead",
        deadExpiresAt: nowMs + DEAD_TTL_MS,
        leaseUntil: 0,
        nextRetryAt: 0,
      },
    };
  }

  const exp = Math.min(retryCount, 20);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_CAP_MS);
  const jitterFrac =
    (parseInt(fnv1a64Hex(item.id).slice(0, 4), 16) % 50) / 100 - 0.25;
  const backoffMs = Math.max(1000, Math.floor(base * (1 + jitterFrac)));

  return {
    action: "requeue",
    item: {
      ...item,
      state: "queued",
      leaseUntil: 0,
      nextRetryAt: nowMs + backoffMs,
    },
    backoffMs,
  };
}

/**
 * Mark item sending: persist retryCount bump BEFORE dispatch (crash-proof ceiling).
 * Also stamps context.attempt from the new retryCount (1..5).
 */
export function markSending(
  item: QueueItem,
  nowMs: number,
  leaseMs: number,
): QueueItem {
  const retryCount = item.retryCount + 1;
  const attempt = Math.min(5, Math.max(1, retryCount));
  const report: TelemetryReport = {
    ...item.report,
    context: {
      ...item.report.context,
      attempt,
    },
  };
  return {
    ...item,
    report,
    state: "sending",
    retryCount,
    leaseUntil: nowMs + leaseMs,
  };
}

export function isReadyToSend(item: QueueItem, nowMs: number): boolean {
  if (item.state !== "queued") return false;
  if (item.nextRetryAt > nowMs) return false;
  return true;
}

/** Format a manual report preview (user pastes into GitHub). No secrets. */
export function formatManualReportPreview(report: TelemetryReport): string {
  const lines = [
    "### Kalsa telemetry report (manual)",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
    "Telemetry signature fields: code=" +
      report.error.code +
      (report.error.detail ? ` detail=${report.error.detail}` : "") +
      (report.error.signal ? ` signal=${report.error.signal}` : "") +
      ` appVersion=${report.appVersion} deviceBucket=${report.deviceBucket} dateBucket=${report.dateBucket}`,
    "",
    "_Do not paste chat contents, documents, or API keys._",
  ];
  return lines.join("\n");
}

/** True if a string looks like free text that must never become detail. */
export function looksLikeUnsafeDetail(s: string): boolean {
  if (typeof s !== "string") return true;
  if (/https?:\/\//i.test(s)) return true;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return true;
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(s)) return true;
  if (/[\\/][\w.-]+[\\/]/.test(s)) return true;
  if (/[?&][a-zA-Z0-9_]+=/.test(s)) return true;
  if (/api[_-]?key|token|secret|password/i.test(s)) return true;
  if (s.length > 32) return true;
  return false;
}

// ── Detail classifiers (fixed enums from real errors) ───────────────────────

export function classifyHttpDetail(
  status: number | null | undefined,
): DetailValue {
  if (status === 403) return "http_403";
  if (status === 404) return "http_404";
  if (typeof status === "number" && status >= 500 && status <= 599) {
    return "http_5xx";
  }
  if (typeof status === "number" && status === 413) return "payload_too_large";
  return "unknown";
}

export function classifyNetworkFailure(
  err: unknown,
): "dns" | "tls" | "timeout" | "oom" | "unknown" {
  try {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : String(err ?? "");
    const m = msg.toLowerCase();
    if (
      m.includes("timeout") ||
      m.includes("timed out") ||
      m.includes("deadline")
    ) {
      return "timeout";
    }
    if (
      m.includes("enotfound") ||
      m.includes("getaddrinfo") ||
      m.includes("dns") ||
      m.includes("name not resolved") ||
      m.includes("nodename")
    ) {
      return "dns";
    }
    if (
      m.includes("ssl") ||
      m.includes("tls") ||
      m.includes("cert") ||
      m.includes("handshake")
    ) {
      return "tls";
    }
    if (m.includes("oom") || m.includes("out of memory")) return "oom";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function classifyEngineInitFailure(
  err: unknown,
): import("./config").EngineInitDetail {
  try {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : String(err ?? "");
    const m = msg.toLowerCase();
    const sig = extractSignal(msg);
    if (sig === "ENOSPC" || m.includes("no space") || m.includes("enospc")) {
      return "disk_full";
    }
    if (
      sig === "out of memory" ||
      sig === "ENOMEM" ||
      m.includes("oom") ||
      m.includes("out of memory")
    ) {
      return "oom";
    }
    if (
      m.includes("file not found") ||
      m.includes("enoent") ||
      m.includes("missing") ||
      m.includes("no such file")
    ) {
      return "model_missing";
    }
    if (
      m.includes("corrupt") ||
      m.includes("invalid gguf") ||
      m.includes("bad magic") ||
      m.includes("unable to map") ||
      (sig != null && sig.startsWith("ggml"))
    ) {
      return "model_corrupt";
    }
    if (m.includes("timeout") || m.includes("timed out")) {
      return "init_timeout";
    }
    if (
      m.includes("segmentation") ||
      m.includes("native") ||
      m.includes("crash") ||
      m.includes("signal ")
    ) {
      return "native_crash";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function classifyChatFailure(
  err: unknown,
): import("./config").ChatDetail {
  try {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : String(err ?? "");
    const m = msg.toLowerCase();
    if (m.includes("oom") || m.includes("out of memory")) return "oom";
    if (
      m.includes("context") ||
      m.includes("n_ctx") ||
      m.includes("overflow") ||
      m.includes("ctx")
    ) {
      return "ctx_overflow";
    }
    if (m.includes("abort") || m.includes("stopp") || m.includes("cancel")) {
      return "stop_aborted";
    }
    if (
      m.includes("segmentation") ||
      m.includes("native") ||
      m.includes("crash")
    ) {
      return "native_crash";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function classifyEmbedFailure(
  reason: string | undefined,
  err?: unknown,
): import("./config").EmbedDetail {
  try {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : typeof reason === "string"
            ? reason
            : "";
    const m = msg.toLowerCase();
    if (m.includes("gate") || m.includes("resident") || m.includes("refused")) {
      return "gate_aborted";
    }
    if (m.includes("oom") || m.includes("out of memory")) return "oom";
    if (
      m.includes("corrupt") ||
      m.includes("gguf") ||
      m.includes("model") ||
      (extractSignal(msg) ?? "").startsWith("ggml")
    ) {
      return "model_corrupt";
    }
    if (
      m.includes("native") ||
      m.includes("crash") ||
      m.includes("segmentation")
    ) {
      return "native_crash";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
