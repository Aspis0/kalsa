/**
 * Tool web_fetch — open a page already surfaced by web_search (or pasted by the
 * user) and extract passages relevant to a query via the retrieval loop.
 *
 * Privacy core: every fetch URL must be on a per-turn FetchAllowlist seeded from
 * search result URLs and http(s) links in the current user message. Crafted URLs
 * the model invents are refused without a network call. Redirects cannot widen
 * the allowlist: final URL must be publicly routable and either same-host or
 * already allowlisted; https→http downgrades are refused.
 *
 * Pure enough for the Node harness: no LlamaService / React Native imports.
 * Catalog strings come from en/it directly so tsc --ignoreConfig stays RN-free.
 *
 * Accepted limitations (audit):
 * - F7: abort signal listener fan-in when AbortSignal.any is missing is bounded
 *   by the turn (one manual combine per fetch); not a process-lifetime leak.
 * - F12: non-UTF-8 response bodies may mojibake via response.text(); RN fetch
 *   has no charset/stream control on this path — accepted residual.
 */

import { en } from "../i18n/en";
import { it } from "../i18n/it";
import type { Locale } from "../i18n/types";
import { DocRetrieverIndex, runRetrievalLoop } from "../context/retrievalLoop";
import { htmlToText } from "../util/htmlToText";
import { isSafeHttpUrl } from "../util/url";

/** Structural match for EngineTool (avoid importing LlamaService in the harness). */
export type WebFetchToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type WebFetchSource = {
  title: string;
  url: string;
  provider: string;
};

export type WebFetchToolResult = {
  text: string;
  sources?: WebFetchSource[];
};

const FETCH_TIMEOUT_MS = 15_000;
const BODY_HARD_CAP = 1_500_000;
const RETRIEVAL_BUDGET_CHARS = 1800;

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

/** Extract http(s) URLs from free text (user messages). */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;

export const WEB_FETCH_TOOL: WebFetchToolDef = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch a web page the model has seen in search results (or that the user pasted) and extract the passages relevant to a query.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Page URL to fetch — must be a search result or a link the user provided.",
        },
        query: {
          type: "string",
          description: "What you want to find in the page — a specific question or topic, not a bare keyword dump.",
        },
      },
      required: ["url", "query"],
    },
  },
};

export interface FetchAllowlist {
  add(url: string): void;
  has(url: string): boolean;
  addFromText(text: string): void;
}

/**
 * Normalize for allowlist comparison and for the actual fetch (F8):
 * - trim, drop trailing `)` `,` `.` `;` artifacts
 * - scheme + host case-insensitive
 * - path + query case-sensitive
 * - ignore `#fragment`
 */
export function normalizeFetchUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  // Drop trailing punctuation / closing parens commonly glued to URLs in prose.
  while (s.length > 0 && /[),\.;]$/.test(s)) {
    s = s.slice(0, -1);
  }
  s = s.trim();
  if (!s) return null;

  const m = /^([a-zA-Z][a-zA-Z\d+\-.]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s);
  if (!m) {
    // Not a parseable absolute URL — still store a best-effort key so exact
    // re-checks of the same string can match after trailing-punct strip.
    return s;
  }
  const scheme = m[1].toLowerCase();
  const authority = m[2];
  // Host is case-insensitive; userinfo (if any) is preserved in the key for
  // identity, but isPubliclyRoutableHttpUrl rejects userinfo outright.
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : "";
  const hostPort = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
  const path = m[3] ?? "";
  const query = m[4] ?? "";
  return `${scheme}://${userinfo}${hostPort}${path}${query}`;
}

/**
 * Extract host (no port, no brackets for IPv6) from an http(s) URL.
 * Hand-parsed — no Node/RN URL constructor. Returns lowercased host or null.
 */
export function extractHttpHost(url: string): string | null {
  if (typeof url !== "string") return null;
  const m = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(url.trim());
  if (!m) return null;
  let authority = m[1];
  // Reject / strip userinfo: presence of @ is rejected by isPubliclyRoutableHttpUrl;
  // for host extraction take the part after the last @.
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);

  // IPv6 in brackets: [2001:db8::1]:443
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    return authority.slice(1, end).toLowerCase();
  }

  // Host:port — strip port (last : for IPv4/hostname; IPv6 without brackets is rare).
  const colon = authority.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(authority.slice(colon + 1))) {
    authority = authority.slice(0, colon);
  }
  return authority.toLowerCase();
}

function extractScheme(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z\d+\-.]*)/.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Case-insensitive host equality (no suffix matching); ports ignored. */
export function sameHost(a: string, b: string): boolean {
  const ha = extractHttpHost(a);
  const hb = extractHttpHost(b);
  return ha != null && hb != null && ha === hb;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function isBlockedIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a >= 224 && a <= 239) return true; // 224/4 multicast
  if (a >= 240) return true; // 240/4 + 255.255.255.255
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped ::ffff:a.b.c.d
  const v4dot = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(h);
  if (v4dot) {
    const oct = parseIPv4(v4dot[1]);
    return oct ? isBlockedIPv4(oct) : true;
  }
  // IPv4-mapped hex form ::ffff:7f00:1 → 127.0.0.1
  const v4hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (v4hex) {
    const hi = parseInt(v4hex[1], 16);
    const lo = parseInt(v4hex[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return true;
    const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    return isBlockedIPv4(octets);
  }

  // Leading hextet checks (ULA fc00::/7, link-local fe80::/10).
  if (h.startsWith("::")) {
    // Compressed forms that are not :: or ::1 already handled; remaining ::x
    // are not ULA/link-local by prefix.
    return false;
  }
  const firstTok = h.split(":")[0] ?? "";
  if (!/^[0-9a-f]{1,4}$/i.test(firstTok)) return false;
  const first = parseInt(firstTok, 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/**
 * True only if the URL is safe http(s) AND the host is publicly routable
 * (blocks localhost, RFC1918, CGNAT, link-local, ULA, multicast, bare intranet
 * names, and any userinfo). Hand-parsed — no URL constructor.
 */
export function isPubliclyRoutableHttpUrl(url: string): boolean {
  if (!isSafeHttpUrl(url)) return false;

  const trimmed = url.trim();
  // Authority between :// and first /?#
  const authMatch = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(trimmed);
  if (!authMatch) return false;
  const authority = authMatch[1];

  // Userinfo → reject outright (credential injection / confusing authority).
  if (authority.includes("@")) return false;

  const host = extractHttpHost(trimmed);
  if (!host) return false;

  if (host === "localhost" || host.endsWith(".localhost")) return false;

  const v4 = parseIPv4(host);
  if (v4) return !isBlockedIPv4(v4);

  // IPv6 (contains ':' — brackets already stripped by extractHttpHost)
  if (host.includes(":")) return !isBlockedIPv6(host);

  // Bare single-label hostname (intranet) — no dot.
  if (!host.includes(".")) return false;

  return true;
}

export function makeFetchAllowlist(): FetchAllowlist {
  const keys = new Set<string>();

  return {
    add(url: string): void {
      const key = normalizeFetchUrl(url);
      if (key) keys.add(key);
    },
    has(url: string): boolean {
      const key = normalizeFetchUrl(url);
      return key != null && keys.has(key);
    },
    addFromText(text: string): void {
      if (typeof text !== "string" || !text) return;
      URL_IN_TEXT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = URL_IN_TEXT_RE.exec(text)) !== null) {
        this.add(match[0]);
      }
    },
  };
}

function catalog(locale: Locale) {
  return locale === "it" ? it : en;
}

function hostOf(url: string): string {
  return extractHttpHost(url) ?? url;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; code?: string };
  return e.name === "AbortError" || e.code === "ABORT_ERR";
}

function mediaTypeOf(contentTypeHeader: string | null): string | null {
  if (contentTypeHeader == null || contentTypeHeader === "") return null;
  return contentTypeHeader.split(";")[0]?.trim().toLowerCase() || null;
}

export type WebFetchExecutorDeps = {
  /** Injected fetch for harnesses; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Build a web_fetch executor bound to a per-turn allowlist.
 * Missing/empty args and policy refusals return i18n text (never throw).
 */
export function makeWebFetchExecutor(
  locale: Locale,
  allowlist: FetchAllowlist,
  deps?: WebFetchExecutorDeps,
): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<WebFetchToolResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;

  return async (name, args, signal) => {
    const errors = catalog(locale).errors;

    if (name !== "web_fetch") {
      return { text: errors.unknownTool.replace("{name}", name) };
    }

    const rawArgs = args && typeof args === "object" ? args : {};
    const rawUrl = String((rawArgs as { url?: unknown }).url ?? "").trim();
    const query = String((rawArgs as { query?: unknown }).query ?? "").trim();

    if (!rawUrl) return { text: errors.webFetchEmptyUrl };
    if (!query) return { text: errors.webFetchEmptyQuery };

    // F8: fetch exactly the normalized form used for allowlist comparison.
    const url = normalizeFetchUrl(rawUrl) ?? rawUrl;

    if (!isPubliclyRoutableHttpUrl(url)) {
      return { text: errors.webFetchUnsafeUrl };
    }

    if (!allowlist.has(url)) {
      return { text: errors.webFetchBlockedAllowlist };
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);

    let combined: AbortSignal = timeoutController.signal;
    try {
      if (signal) {
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
          combined = AbortSignal.any([signal, timeoutController.signal]);
        } else if (signal.aborted) {
          combined = signal;
        } else {
          // Manual combine when AbortSignal.any is unavailable.
          const manual = new AbortController();
          const onAbort = () => manual.abort();
          signal.addEventListener("abort", onAbort, { once: true });
          timeoutController.signal.addEventListener("abort", onAbort, { once: true });
          combined = manual.signal;
        }
      }

      let response: Response;
      try {
        // redirect mode: browsers/RN follow by default; we re-validate response.url.
        // Explicit "follow" is a no-op on most implementations (native default).
        response = await fetchImpl(url, {
          signal: combined,
          redirect: "follow",
        });
      } catch (error) {
        if (isAbortError(error) || combined.aborted || timeoutController.signal.aborted) {
          return { text: errors.webFetchTimeout };
        }
        return {
          text: errors.webFetchFailed.replace(
            "{message}",
            error instanceof Error ? error.message : String(error),
          ),
        };
      }

      // Post-redirect URL: empty response.url falls back to the requested url
      // (fail-safe — re-validates the original). Never read body on refusal.
      const finalUrl =
        typeof response.url === "string" && response.url.trim() ? response.url.trim() : url;

      const finalPublic = isPubliclyRoutableHttpUrl(finalUrl);
      const finalAllowed = allowlist.has(finalUrl) || sameHost(finalUrl, url);
      const requestedScheme = extractScheme(url);
      const finalScheme = extractScheme(finalUrl);
      const downgrade =
        requestedScheme === "https" && finalScheme !== null && finalScheme !== "https";

      if (!finalPublic || !finalAllowed || downgrade) {
        return { text: errors.webFetchBlockedRedirect };
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          text: errors.webFetchHttpError.replace("{status}", String(response.status)),
        };
      }

      const mediaType = mediaTypeOf(response.headers?.get?.("content-type") ?? null);
      if (mediaType && !ALLOWED_CONTENT_TYPES.has(mediaType)) {
        return {
          text: errors.webFetchUnsupportedContent.replace("{type}", mediaType),
        };
      }

      // F2: Content-Length pre-check — refuse before buffering the body when the
      // declared size exceeds BODY_HARD_CAP. Residual risk (audit F2): when the
      // header is absent we still fully buffer via response.text() before the
      // post-read slice; streaming is not available through RN's fetch/Blob path.
      const clRaw = response.headers?.get?.("content-length");
      if (clRaw != null && clRaw !== "") {
        const declared = Number(clRaw);
        if (Number.isFinite(declared) && declared > BODY_HARD_CAP) {
          try {
            timeoutController.abort();
          } catch {
            /* ignore */
          }
          const sizeKb = Math.max(1, Math.ceil(declared / 1024));
          return {
            text: errors.webFetchTooLarge.replace("{sizeKb}", String(sizeKb)),
          };
        }
      }

      let bodyText: string;
      try {
        const raw = await response.text();
        bodyText = typeof raw === "string" ? raw : String(raw ?? "");
      } catch (error) {
        if (isAbortError(error)) {
          return { text: errors.webFetchTimeout };
        }
        return {
          text: errors.webFetchFailed.replace(
            "{message}",
            error instanceof Error ? error.message : String(error),
          ),
        };
      }

      if (bodyText.length > BODY_HARD_CAP) {
        bodyText = bodyText.slice(0, BODY_HARD_CAP);
      }

      const isPlain = mediaType === "text/plain";
      let title: string | null = null;
      let pageText: string;
      if (isPlain) {
        pageText = bodyText;
      } else {
        const extracted = htmlToText(bodyText);
        title = extracted.title;
        pageText = extracted.text;
      }

      const index = new DocRetrieverIndex();
      index.append([{ docId: finalUrl, title: title ?? undefined, text: pageText }]);
      const { passages, trace } = runRetrievalLoop(index, query, {
        budgetChars: RETRIEVAL_BUDGET_CHARS,
      });

      const pageHost = hostOf(finalUrl);
      const displayTitle = title ?? pageHost;

      // Char n-grams can score weak BM25 hits with zero content-word coverage;
      // treat coverage 0 (or no passages) as a true nothing-matched outcome.
      // F6: no sources on this path — no cite instruction / source card.
      // F11: use host (not untrusted <title>) inside the directive message.
      const lastCoverage =
        trace.coverageByRound.length > 0
          ? (trace.coverageByRound[trace.coverageByRound.length - 1] ?? 0)
          : 0;
      if (!passages.length || lastCoverage <= 0) {
        return {
          text: errors.webFetchNothingMatched.replace("{host}", pageHost),
          sources: [],
        };
      }

      const sources: WebFetchSource[] = [
        { title: displayTitle, url: finalUrl, provider: "fetch" },
      ];

      const body = passages
        .map((p, i) => `${i + 1}. ${p.text}`)
        .join("\n\n");

      // Cite instruction is appended by LlamaService with absolute source numbers.
      return { text: body, sources };
    } finally {
      clearTimeout(timer);
    }
  };
}
