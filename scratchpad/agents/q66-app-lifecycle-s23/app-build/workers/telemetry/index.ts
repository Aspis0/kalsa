/**
 * Kalsa telemetry Cloudflare Worker (TELEMETRY_OPTIN.md v14 FINAL + diag-addendum).
 *
 * POST /report  — strict schema validation → IP rate limit → DO TelemetryBuffer
 * GET  /flush   — Authorization: Bearer FLUSH_TOKEN → maintainer flush
 * POST /admin/flush-and-purge — Authorization: Bearer ADMIN_TOKEN → wipe DO buffer
 *
 * Never auto-creates issues from /report. No payload logging.
 * GITHUB_TOKEN stays in the Worker (never serialized into the DO).
 */

import {
  BODY_LIMIT,
  GLOBAL_QUOTA,
  GLOBAL_WINDOW_MS,
  GITHUB_SEARCH_TIMEOUT_MS,
  IP_MAP_MAX,
  LEASE_MS,
  applyLeaseTransition,
  buildIssueBody,
  classifyGithubSearchResponse,
  contentLengthExceeds,
  decideCreateIssue,
  decodeUtf8Strict,
  emptyBufferState,
  issueTitleFromProjection,
  projectIssueFields,
  pruneIpMap,
  reportRejectStatus,
  signatureFields,
  tryAcquireLease,
  validAdminAuth,
  validFlushAuth,
  validateReport,
  type BufferEntry,
  type BufferState,
  type GithubSearchOutcome,
} from "./schema";

export {
  validateReport,
  decideCreateIssue,
  classifyGithubSearchResponse,
  signatureFields,
  buildIssueBody,
  projectIssueFields,
} from "./schema";

export interface Env {
  TELEMETRY_BUFFER: DurableObjectNamespace;
  DEDUPE_KV: KVNamespace;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  FLUSH_TOKEN?: string;
  ADMIN_TOKEN?: string;
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

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only trust Cloudflare's connecting IP. Do not fall back to x-forwarded-for. */
function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || "unknown";
}

function checkIpRate(ip: string, now: number): boolean {
  pruneIpMap(ipHits, now, IP_WINDOW_MS, IP_MAP_MAX);
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
      if (request.method === "POST" && url.pathname === "/admin/flush-and-purge") {
        return await handleAdminPurge(request, env);
      }
      return json(404, { error: "not_found" });
    } catch {
      return json(500, { error: "internal" });
    }
  },
};

async function readBoundedBody(request: Request): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: number; error: string }
> {
  if (contentLengthExceeds(request.headers.get("content-length"), BODY_LIMIT)) {
    return { ok: false, status: 413, error: "body_too_large" };
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > BODY_LIMIT) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { ok: false, status: 413, error: "body_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes };
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const raw = await readBoundedBody(request);
  if (!raw.ok) return json(raw.status, { error: raw.error });

  const text = decodeUtf8Strict(raw.bytes);
  if (text === null) return json(400, { error: "invalid_utf8" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
    return json(200, body);
  }

  const status = reportRejectStatus(body.reason);
  return json(status, body);
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

  if (!autoOpen) {
    const res = await stub.fetch("https://do/flush-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ now: Date.now() }),
    });
    const body = await res.json();
    return json(res.status, body);
  }

  // autoOpen: Worker owns GitHub I/O. DO only leases / transitions.
  // GITHUB_TOKEN is never serialized into the DO.
  const candRes = await stub.fetch("https://do/candidates", { method: "POST" });
  const candBody = (await candRes.json()) as { reportIds?: string[] };
  const candidates = Array.isArray(candBody.reportIds) ? candBody.reportIds : [];

  let created = 0;
  let skipped = 0;
  let duplicates = 0;
  let released = 0;
  const now = Date.now();
  const repo = env.GITHUB_REPO ?? "";
  const token = env.GITHUB_TOKEN ?? "";

  for (const reportId of candidates) {
    const leaseRes = await stub.fetch("https://do/lease", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId, now }),
    });
    const leased = (await leaseRes.json()) as {
      ok?: boolean;
      token?: number;
      entry?: BufferEntry;
    };
    if (!leased.ok || leased.token == null || !leased.entry) {
      skipped += 1;
      continue;
    }
    const { token: fence, entry } = leased;

    if (!token || !repo) {
      await transition(stub, reportId, fence, "pending", now);
      released += 1;
      continue;
    }

    const marker = `Telemetry signature: ${entry.sig}`;
    const first = await githubSearchIssue(repo, token, marker);
    let second: GithubSearchOutcome | null = null;
    if (first === "not_found") {
      await sleep(2000);
      second = await githubSearchIssue(repo, token, marker);
    }
    const decision = decideCreateIssue(first, second);
    if (decision === "release") {
      await transition(stub, reportId, fence, "pending", now);
      released += 1;
      continue;
    }
    if (decision === "mark_created") {
      const ok = await transition(stub, reportId, fence, "created", now);
      if (ok) duplicates += 1;
      continue;
    }

    const ok = await githubCreateIssue(repo, token, entry);
    if (ok) {
      const wrote = await transition(stub, reportId, fence, "created", now);
      if (wrote) created += 1;
    } else {
      await transition(stub, reportId, fence, "pending", now);
      released += 1;
    }
  }

  return json(200, { created, skipped, duplicates, released });
}

async function transition(
  stub: DurableObjectStub,
  reportId: string,
  token: number,
  nextState: "created" | "pending",
  now: number,
): Promise<boolean> {
  const res = await stub.fetch("https://do/transition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId, token, nextState, now }),
  });
  const body = (await res.json()) as { ok?: boolean };
  return body.ok === true;
}

async function handleAdminPurge(request: Request, env: Env): Promise<Response> {
  const auth = validAdminAuth(env.ADMIN_TOKEN, request.headers.get("authorization"));
  if (!auth.ok) {
    return json(auth.status, {
      error: auth.status === 503 ? "admin_token_unset" : "unauthorized",
    });
  }
  const stub = bufferStub(env);
  const res = await stub.fetch("https://do/purge", { method: "POST" });
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
    if (request.method === "POST" && url.pathname === "/flush-review") {
      return this.flushReview();
    }
    if (request.method === "POST" && url.pathname === "/candidates") {
      return this.candidates();
    }
    if (request.method === "POST" && url.pathname === "/lease") {
      const body = (await request.json()) as { reportId: string; now: number };
      return this.lease(body.reportId, body.now);
    }
    if (request.method === "POST" && url.pathname === "/transition") {
      const body = (await request.json()) as {
        reportId: string;
        token: number;
        nextState: "created" | "pending";
        now: number;
      };
      return this.transition(body.reportId, body.token, body.nextState, body.now);
    }
    if (request.method === "POST" && url.pathname === "/purge") {
      return this.purge();
    }
    return json(404, { error: "not_found" });
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
      // No silent eviction: accepted reports stay until maintainer flush/purge.
      await txn.put("state", st);
      return { accepted: true as const, reportId };
    });

    if (!result.accepted) {
      return json(reportRejectStatus(result.reason), {
        accepted: false,
        reason: result.reason,
      });
    }
    return json(200, { accepted: true });
  }

  private async flushReview(): Promise<Response> {
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

  private async candidates(): Promise<Response> {
    const st =
      (await this.state.storage.get<BufferState>("state")) ?? emptyBufferState();
    const reportIds = st.entries
      .filter((e) => e.state === "pending" || e.state === "creating")
      .map((e) => e.reportId);
    return json(200, { reportIds });
  }

  private async lease(reportId: string, now: number): Promise<Response> {
    const acquired = await this.state.storage.transaction(async (txn) => {
      const st = (await txn.get<BufferState>("state")) ?? emptyBufferState();
      const result = tryAcquireLease(st, reportId, now, LEASE_MS);
      if (!result.ok) return null;
      await txn.put("state", result.state);
      const entry = result.state.entries.find((e) => e.reportId === reportId);
      if (!entry) return null;
      return { token: result.token, entry };
    });
    if (!acquired) return json(200, { ok: false });
    return json(200, { ok: true, token: acquired.token, entry: acquired.entry });
  }

  private async transition(
    reportId: string,
    expectedToken: number,
    nextState: "created" | "pending",
    now: number,
  ): Promise<Response> {
    const ok = await this.state.storage.transaction(async (txn) => {
      const st = (await txn.get<BufferState>("state")) ?? emptyBufferState();
      const applied = applyLeaseTransition(st, reportId, expectedToken, nextState, now);
      if (!applied.ok) return false;
      await txn.put("state", applied.state);
      return true;
    });
    return json(200, { ok });
  }

  private async purge(): Promise<Response> {
    let purged = 0;
    await this.state.storage.transaction(async (txn) => {
      const st = (await txn.get<BufferState>("state")) ?? emptyBufferState();
      purged = st.entries.length;
      await txn.put("state", emptyBufferState());
    });
    return json(200, { purged });
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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GITHUB_SEARCH_TIMEOUT_MS);
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
        signal: ac.signal,
      },
    );
    if (!res.ok) {
      return classifyGithubSearchResponse({ ok: false, status: res.status });
    }
    const data = (await res.json()) as { total_count?: unknown };
    const totalCount =
      typeof data.total_count === "number" ? data.total_count : undefined;
    return classifyGithubSearchResponse({
      ok: true,
      status: res.status,
      totalCount,
    });
  } catch {
    return classifyGithubSearchResponse({ ok: false, threw: true });
  } finally {
    clearTimeout(timer);
  }
}

async function githubCreateIssue(
  repo: string,
  token: string,
  entry: BufferEntry,
): Promise<boolean> {
  try {
    const projection = projectIssueFields(entry.report);
    const title = issueTitleFromProjection(projection);
    const body = buildIssueBody(entry.sig, entry.report);
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "kalsa-telemetry-worker",
      },
      body: JSON.stringify({
        title,
        body,
        labels: ["telemetry"],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
