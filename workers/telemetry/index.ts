/**
 * Kalsa telemetry Cloudflare Worker (TELEMETRY_OPTIN.md v14 FINAL + diag-addendum).
 *
 * POST /report  — strict schema validation → IP rate limit → DO TelemetryBuffer
 * GET  /flush   — Authorization: Bearer FLUSH_TOKEN → maintainer flush
 *
 * Never auto-creates issues from /report. No payload logging.
 */

import {
  BODY_LIMIT,
  GLOBAL_QUOTA,
  GLOBAL_WINDOW_MS,
  LEASE_MS,
  applyLeaseTransition,
  classifyGithubSearchResponse,
  decideCreateIssue,
  emptyBufferState,
  tryAcquireLease,
  validateReport,
  validFlushAuth,
  type BufferEntry,
  type BufferState,
  type GithubSearchOutcome,
} from "./schema";

export { validateReport, decideCreateIssue, classifyGithubSearchResponse } from "./schema";

export interface Env {
  TELEMETRY_BUFFER: DurableObjectNamespace;
  DEDUPE_KV: KVNamespace;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  FLUSH_TOKEN?: string;
  AUTO_OPEN_ISSUES?: string;
}

const IP_RATE_LIMIT = 10;
const IP_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_TTL_SEC = 180 * 24 * 60 * 60; // 180 days

// Best-effort in-memory IP rate (single isolate; not global).
const ipHits = new Map<string, number[]>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  const auth = validFlushAuth(env.FLUSH_TOKEN, request.headers.get("authorization"));
  if (!auth.ok) {
    return json(auth.status, {
      error: auth.status === 503 ? "flush_token_unset" : "unauthorized",
    });
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
      // No silent eviction: accepted reports stay until maintainer flush.
      // Retention is explicit (flush / manual deletion), never a hidden cap.
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

    // autoOpen: transactional lease → search (2×, error ≠ not_found) → create
    let created = 0;
    let skipped = 0;
    let duplicates = 0;
    let released = 0;

    const snapshot = await this.load();
    const candidates = snapshot.entries
      .filter((e) => e.state === "pending" || e.state === "creating")
      .map((e) => e.reportId);

    for (const reportId of candidates) {
      const leased = await this.casAcquireLease(reportId, opts.now);
      if (!leased) {
        skipped += 1;
        continue;
      }
      const { token, entry } = leased;

      if (!opts.githubToken || !opts.githubRepo) {
        await this.casTransition(reportId, token, "pending");
        released += 1;
        continue;
      }

      const marker = `Telemetry signature: ${entry.sig}`;
      const first = await githubSearchIssue(opts.githubRepo, opts.githubToken, marker);
      let second: GithubSearchOutcome | null = null;
      if (first === "not_found") {
        await sleep(2000);
        second = await githubSearchIssue(opts.githubRepo, opts.githubToken, marker);
      }
      const decision = decideCreateIssue(first, second);
      if (decision === "release") {
        await this.casTransition(reportId, token, "pending");
        released += 1;
        continue;
      }
      if (decision === "mark_created") {
        const ok = await this.casTransition(reportId, token, "created");
        if (ok) duplicates += 1;
        continue;
      }

      const ok = await githubCreateIssue(
        opts.githubRepo,
        opts.githubToken,
        entry,
        marker,
      );
      if (ok) {
        const wrote = await this.casTransition(reportId, token, "created");
        if (wrote) created += 1;
      } else {
        await this.casTransition(reportId, token, "pending");
        released += 1;
      }
    }

    return json(200, { created, skipped, duplicates, released });
  }

  /** Lease acquisition inside storage.transaction() with fencing token CAS. */
  private async casAcquireLease(
    reportId: string,
    now: number,
  ): Promise<{ token: number; entry: BufferEntry } | null> {
    return this.state.storage.transaction(async (txn) => {
      const st = (await txn.get<BufferState>("state")) ?? emptyBufferState();
      const acquired = tryAcquireLease(st, reportId, now, LEASE_MS);
      if (!acquired.ok) return null;
      await txn.put("state", acquired.state);
      const entry = acquired.state.entries.find((e) => e.reportId === reportId);
      if (!entry) return null;
      return { token: acquired.token, entry };
    });
  }

  /** Final state transition inside storage.transaction() — stale token refused. */
  private async casTransition(
    reportId: string,
    expectedToken: number,
    nextState: "created" | "pending",
  ): Promise<boolean> {
    return this.state.storage.transaction(async (txn) => {
      const st = (await txn.get<BufferState>("state")) ?? emptyBufferState();
      const applied = applyLeaseTransition(st, reportId, expectedToken, nextState);
      if (!applied.ok) return false;
      await txn.put("state", applied.state);
      return true;
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function githubSearchIssue(
  repo: string,
  token: string,
  marker: string,
): Promise<GithubSearchOutcome> {
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
    if (!res.ok) {
      return classifyGithubSearchResponse({ ok: false, status: res.status });
    }
    const data = (await res.json()) as { total_count?: number };
    return classifyGithubSearchResponse({
      ok: true,
      status: res.status,
      totalCount: data.total_count ?? 0,
    });
  } catch {
    return classifyGithubSearchResponse({ ok: false, threw: true });
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
