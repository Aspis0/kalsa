/**
 * Kalsa telemetry Cloudflare Worker (TELEMETRY_OPTIN.md v14 FINAL + diag-addendum).
 *
 * POST /report  — strict schema validation → IP rate limit → DO TelemetryBuffer
 * GET  /flush   — Authorization: Bearer FLUSH_TOKEN → maintainer flush
 *
 * Never auto-creates issues from /report. No payload logging.
 */

export interface Env {
  TELEMETRY_BUFFER: DurableObjectNamespace;
  DEDUPE_KV: KVNamespace;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  FLUSH_TOKEN?: string;
  AUTO_OPEN_ISSUES?: string;
}

const BODY_LIMIT = 4 * 1024;
const IP_RATE_LIMIT = 10;
const IP_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_QUOTA = 50;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_TTL_SEC = 180 * 24 * 60 * 60; // 180 days
const LEASE_MS = 5 * 60 * 1000;
const SIGNAL_MAX = 80;
const SIGNAL_CHARSET = /^[A-Za-z0-9_ .*\-]+$/;

const REASON_CODES = new Set([
  "engine.init",
  "chat.generation",
  "embed.native",
  "web.fetch",
  "web.search",
  "unknown",
]);

const WEB_DETAILS = new Set([
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
const ENGINE_INIT_DETAILS = new Set([
  "oom",
  "disk_full",
  "model_corrupt",
  "model_missing",
  "init_timeout",
  "native_crash",
  "unknown",
]);
const CHAT_DETAILS = new Set([
  "oom",
  "native_crash",
  "ctx_overflow",
  "stop_aborted",
  "unknown",
]);
const EMBED_DETAILS = new Set([
  "oom",
  "model_corrupt",
  "native_crash",
  "gate_aborted",
  "unknown",
]);

const DEVICE_BUCKETS = new Set(["low", "mid", "high"]);
const MEMORY_CLASSES = new Set(["lt-4gb", "4-6gb", "ge-6gb", "unknown"]);
const MODEL_CATEGORIES = new Set(["dense.2b", "dense.4b", "moe", "unknown"]);
const PHASES = new Set(["download", "load", "turn", "embed", "flush"]);

const SIGNAL_FIXED = new Set([
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

const TOP_KEYS = new Set([
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
const ERROR_KEYS = new Set(["code", "detail", "signal"]);
const CONTEXT_KEYS = new Set([
  "modelCategory",
  "memoryClass",
  "hadWebTools",
  "phase",
  "attempt",
  "chunks",
]);

// Best-effort in-memory IP rate (single isolate; not global).
const ipHits = new Map<string, number[]>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function detailsForCode(code: string): Set<string> {
  if (code === "web.fetch" || code === "web.search") return WEB_DETAILS;
  if (code === "engine.init") return ENGINE_INIT_DETAILS;
  if (code === "chat.generation") return CHAT_DETAILS;
  if (code === "embed.native") return EMBED_DETAILS;
  return ENGINE_INIT_DETAILS;
}

function isValidDateBucket(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

function acceptSignal(value: unknown): boolean {
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function signatureFields(report: Record<string, unknown>): string {
  const err = (report.error ?? {}) as Record<string, unknown>;
  const ctx = (report.context ?? {}) as Record<string, unknown>;
  return stableStringify({
    code: err.code ?? "",
    detail: err.detail ?? "",
    signal: err.signal ?? "",
    appVersion: report.appVersion ?? "",
    deviceBucket: report.deviceBucket ?? "",
    modelCategory: ctx.modelCategory ?? "",
    dateBucket: report.dateBucket ?? "",
  });
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkIpRate(ip: string, now: number): boolean {
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_RATE_LIMIT) {
    ipHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

/** Singleton DO id — stable string so quota is truly global. */
function bufferStub(env: Env): DurableObjectStub {
  const id = env.TELEMETRY_BUFFER.idFromName("kalsa-telemetry-buffer-v1");
  return env.TELEMETRY_BUFFER.get(id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/report") {
        return await handleReport(request, env);
      }
      if (request.method === "GET" && url.pathname === "/flush") {
        return await handleFlush(request, env);
      }
      return json(404, { error: "not_found" });
    } catch {
      return json(500, { error: "internal" });
    }
  },
};

async function handleReport(request: Request, env: Env): Promise<Response> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > BODY_LIMIT) {
    return json(413, { error: "body_too_large" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const verr = validateReport(parsed);
  if (verr) return json(400, { error: "invalid_schema", reason: verr });

  const now = Date.now();
  const ip = clientIp(request);
  if (!checkIpRate(ip, now)) {
    return json(429, { error: "ip_rate" });
  }

  const report = parsed as Record<string, unknown>;
  const sig = await sha256Hex(signatureFields(report));

  // KV read-cache only (not authority)
  try {
    const cached = await env.DEDUPE_KV.get(`dedupe:${sig}`);
    if (cached) {
      return json(200, { accepted: false, reason: "duplicate" });
    }
  } catch {
    /* continue to DO */
  }

  const stub = bufferStub(env);
  const res = await stub.fetch("https://do/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sig, report, now }),
  });
  const body = (await res.json()) as {
    accepted: boolean;
    reason?: string;
  };

  if (body.accepted) {
    try {
      await env.DEDUPE_KV.put(`dedupe:${sig}`, "1", {
        expirationTtl: DEDUPE_TTL_SEC,
      });
    } catch {
      /* best-effort cache */
    }
  }

  // Never log payload — only signature prefix + count
  return json(res.status === 200 ? 200 : res.status, body);
}

async function handleFlush(request: Request, env: Env): Promise<Response> {
  const token = env.FLUSH_TOKEN;
  if (!token) {
    return json(503, { error: "flush_token_unset" });
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (auth !== expected) {
    return json(401, { error: "unauthorized" });
  }

  const autoOpen = (env.AUTO_OPEN_ISSUES ?? "false").toLowerCase() === "true";
  const stub = bufferStub(env);
  const res = await stub.fetch("https://do/flush", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      autoOpen,
      githubToken: env.GITHUB_TOKEN ?? "",
      githubRepo: env.GITHUB_REPO ?? "",
      now: Date.now(),
    }),
  });
  const body = await res.json();
  return json(res.status, body);
}

// ── Durable Object: TelemetryBuffer ─────────────────────────────────────────

type BufferEntry = {
  reportId: string;
  sig: string;
  report: unknown;
  state: "pending" | "creating" | "created";
  reviewAck: boolean;
  leaseUntil: number;
  leaseToken: number;
  createdAt: number;
};

type BufferState = {
  entries: BufferEntry[];
  hourBucket: number;
  hourCount: number;
  nextLeaseToken: number;
};

export class TelemetryBuffer {
  state: DurableObjectState;
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/append") {
      const body = (await request.json()) as {
        sig: string;
        report: unknown;
        now: number;
      };
      return this.append(body.sig, body.report, body.now);
    }
    if (request.method === "POST" && url.pathname === "/flush") {
      const body = (await request.json()) as {
        autoOpen: boolean;
        githubToken: string;
        githubRepo: string;
        now: number;
      };
      return this.flush(body);
    }
    return json(404, { error: "not_found" });
  }

  private async load(): Promise<BufferState> {
    const s = await this.state.storage.get<BufferState>("state");
    return (
      s ?? {
        entries: [],
        hourBucket: 0,
        hourCount: 0,
        nextLeaseToken: 1,
      }
    );
  }

  private async append(
    sig: string,
    report: unknown,
    now: number,
  ): Promise<Response> {
    const result = await this.state.storage.transaction(async (txn) => {
      const st =
        (await txn.get<BufferState>("state")) ?? {
          entries: [],
          hourBucket: 0,
          hourCount: 0,
          nextLeaseToken: 1,
        };

      // Dedupe inside transaction (source of truth)
      if (st.entries.some((e) => e.sig === sig)) {
        return { accepted: false, reason: "duplicate" as const };
      }

      const hour = Math.floor(now / GLOBAL_WINDOW_MS);
      if (st.hourBucket !== hour) {
        st.hourBucket = hour;
        st.hourCount = 0;
      }
      if (st.hourCount >= GLOBAL_QUOTA) {
        return { accepted: false, reason: "quota" as const };
      }

      const reportId = crypto.randomUUID();
      st.entries.push({
        reportId,
        sig,
        report,
        state: "pending",
        reviewAck: false,
        leaseUntil: 0,
        leaseToken: 0,
        createdAt: now,
      });
      st.hourCount += 1;
      // Cap buffer growth (keep newest 5000)
      if (st.entries.length > 5000) {
        st.entries = st.entries.slice(st.entries.length - 5000);
      }
      await txn.put("state", st);
      return { accepted: true as const, reportId };
    });

    if (!result.accepted) {
      return json(200, {
        accepted: false,
        reason: result.reason,
      });
    }
    return json(200, { accepted: true });
  }

  private async flush(opts: {
    autoOpen: boolean;
    githubToken: string;
    githubRepo: string;
    now: number;
  }): Promise<Response> {
    if (!opts.autoOpen) {
      // Mark reviewAck only; preserve pending eligibility
      let reviewed = 0;
      await this.state.storage.transaction(async (txn) => {
        const st =
          (await txn.get<BufferState>("state")) ?? {
            entries: [],
            hourBucket: 0,
            hourCount: 0,
            nextLeaseToken: 1,
          };
        for (const e of st.entries) {
          if (e.state === "pending" && !e.reviewAck) {
            e.reviewAck = true;
            reviewed += 1;
          }
        }
        await txn.put("state", st);
      });
      return json(200, { reviewed });
    }

    // autoOpen: lease → search GitHub (2 attempts 2s apart) → create → created
    const st = await this.load();
    let created = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const entry of st.entries) {
      if (entry.state === "created") {
        skipped += 1;
        continue;
      }
      // Clear reviewAck so previously reviewed items become eligible
      if (entry.state !== "pending" && entry.state !== "creating") {
        skipped += 1;
        continue;
      }
      // Expired creating lease → treat as pending
      if (entry.state === "creating" && entry.leaseUntil > opts.now) {
        skipped += 1;
        continue;
      }

      // Mark creating with fencing token
      const leaseToken = st.nextLeaseToken++;
      entry.state = "creating";
      entry.leaseUntil = opts.now + LEASE_MS;
      entry.leaseToken = leaseToken;
      entry.reviewAck = false;
      await this.state.storage.put("state", st);

      if (!opts.githubToken || !opts.githubRepo) {
        // Release lease
        if (entry.leaseToken === leaseToken) {
          entry.state = "pending";
          entry.leaseUntil = 0;
          await this.state.storage.put("state", st);
        }
        continue;
      }

      const marker = `Telemetry signature: ${entry.sig}`;
      let found = await githubSearchIssue(opts.githubRepo, opts.githubToken, marker);
      if (!found) {
        await sleep(2000);
        found = await githubSearchIssue(opts.githubRepo, opts.githubToken, marker);
      }
      if (found) {
        if (entry.leaseToken === leaseToken) {
          entry.state = "created";
          entry.leaseUntil = 0;
          await this.state.storage.put("state", st);
          duplicates += 1;
        }
        continue;
      }

      const ok = await githubCreateIssue(
        opts.githubRepo,
        opts.githubToken,
        entry,
        marker,
      );
      if (ok && entry.leaseToken === leaseToken) {
        entry.state = "created";
        entry.leaseUntil = 0;
        await this.state.storage.put("state", st);
        created += 1;
      } else if (entry.leaseToken === leaseToken) {
        entry.state = "pending";
        entry.leaseUntil = 0;
        await this.state.storage.put("state", st);
      }
    }

    return json(200, { created, skipped, duplicates });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function githubSearchIssue(
  repo: string,
  token: string,
  marker: string,
): Promise<boolean> {
  try {
    const q = encodeURIComponent(`repo:${repo} "${marker}" in:body`);
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&per_page=1`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "kalsa-telemetry-worker",
        },
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { total_count?: number };
    return (data.total_count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function githubCreateIssue(
  repo: string,
  token: string,
  entry: BufferEntry,
  marker: string,
): Promise<boolean> {
  try {
    const report = entry.report as Record<string, unknown>;
    const err = (report.error ?? {}) as Record<string, unknown>;
    const title = `[telemetry] ${err.code ?? "unknown"}${err.detail ? ` / ${err.detail}` : ""}`;
    const body = [
      marker,
      "",
      "```json",
      JSON.stringify(report, null, 2),
      "```",
      "",
      `_reportId: ${entry.reportId}_`,
    ].join("\n");
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "kalsa-telemetry-worker",
      },
      body: JSON.stringify({
        title: title.slice(0, 200),
        body,
        labels: ["telemetry"],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
