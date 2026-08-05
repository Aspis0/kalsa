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
 * Host gate policy (fail-closed): accept ONLY a canonical dotted-quad IPv4 or a
 * boring DNS name. Anything else is refused — the gate never tries to predict
 * what the platform HTTP client (OkHttp / URL) would resolve. IPv6 literals,
 * shorthand IPv4, percent-encoding in the authority, backslashes, and non-ASCII
 * are all rejected.
 *
 * Indexing: only the first MAX_INDEX_CHARS of extracted text are searched
 * (HTML and text/plain); content beyond that is not indexed.
 *
 * Pure enough for the Node harness: no LlamaService / React Native imports.
 * Catalog strings come from en/it directly so tsc --ignoreConfig stays RN-free.
 *
 * Accepted limitations (audit):
 * - Abort-signal listener fan-in when AbortSignal.any is missing is bounded by
 *   the turn (one manual combine per fetch); not a process-lifetime leak.
 * - On React Native the whole body is buffered by the transport (XHR) before
 *   JavaScript sees it, so a Content-Length pre-check is only an early exit —
 *   a hostile allowlisted host can still exhaust memory within FETCH_TIMEOUT_MS.
 *   A real fix needs a native streaming module. Do not claim otherwise.
 */

import { en } from "../i18n/en";
import { it } from "../i18n/it";
import type { Locale } from "../i18n/types";
import { DocRetrieverIndex, runRetrievalLoop } from "../context/retrievalLoop";
import { htmlToText } from "../util/htmlToText";
import { normalizeFetchUrl } from "../util/url";

/** Re-export for callers that import normalize from this module. */
export { normalizeFetchUrl } from "../util/url";

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

/** Shorter download window; does not bound peak memory on RN (see header). */
export const FETCH_TIMEOUT_MS = 8_000;
/** Declared Content-Length / post-read byteLength hard stop. */
export const BODY_HARD_CAP = 1_500_000;
/**
 * Max chars fed into the retrieval index (both HTML and text/plain).
 * Content beyond this is not searched. Matches htmlToText's default output cap.
 */
export const MAX_INDEX_CHARS = 120_000;
export const RETRIEVAL_BUDGET_CHARS = 1800;
const TITLE_CARD_MAX = 120;

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
      "Fetch a web page the model has seen in search results (or that the user pasted) and extract the passages relevant to a query. Only the first ~120k characters of page text are searched.",
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
 * Extract host (no port) from an http(s) URL for same-host / display.
 * Hand-parsed — no Node/RN URL constructor. Returns lowercased host or null.
 * Does not accept userinfo (caller should already have rejected it).
 */
export function extractHttpHost(url: string): string | null {
  if (typeof url !== "string") return null;
  const m = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(url.trim());
  if (!m) return null;
  let authority = m[1];
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);

  // Bracketed hosts are not publicly routable under our gate; still extract for diagnostics.
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    return authority.slice(1, end).toLowerCase();
  }

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

/**
 * Fail-closed public-host gate for web_fetch.
 *
 * True ONLY for canonical dotted-quad IPv4 (then not in private ranges) or a
 * boring DNS name (two+ labels, ASCII alnum/hyphen, alphabetic TLD ≥ 2).
 * Anything else is refused — the gate never tries to predict what the platform
 * HTTP client would resolve (OkHttp shorthand, IPv6 forms, backslash authority
 * truncation, percent-encoding tricks, etc.).
 */
export function isPubliclyRoutableHttpUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const s = url.trim();
  if (!s) return false;

  // Whole-URL hygiene: no backslash, no whitespace/control, no non-ASCII.
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x5c /* \ */) return false;
    if (code <= 0x20 || code === 0x7f) return false;
    if (code > 0x7f) return false;
  }

  const schemeMatch = /^(https?):\/\//i.exec(s);
  if (!schemeMatch) return false;
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;

  const afterScheme = s.slice(schemeMatch[0].length);
  let authEnd = afterScheme.length;
  for (let i = 0; i < afterScheme.length; i++) {
    const c = afterScheme[i];
    if (c === "/" || c === "?" || c === "#") {
      authEnd = i;
      break;
    }
  }
  const authority = afterScheme.slice(0, authEnd);
  if (!authority) return false;

  // No percent-encoding tricks and no userinfo in the authority.
  if (authority.includes("%") || authority.includes("@")) return false;

  // Any bracketed / IPv6 literal host is refused outright.
  if (authority.includes("[") || authority.includes("]")) return false;

  let host = authority;
  const colon = authority.lastIndexOf(":");
  if (colon >= 0) {
    const portStr = authority.slice(colon + 1);
    if (!/^\d{1,5}$/.test(portStr)) return false;
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    host = authority.slice(0, colon);
  }
  if (!host) return false;

  // Canonical dotted-quad IPv4: exactly 4 parts, no leading zeros (except "0").
  if (/^\d/.test(host) || /^[\d.]+$/.test(host)) {
    const parts = host.split(".");
    if (parts.length !== 4) return false;
    const octets: number[] = [];
    for (const p of parts) {
      if (!/^(0|[1-9]\d{0,2})$/.test(p)) return false;
      const n = Number(p);
      if (n > 255) return false;
      octets.push(n);
    }
    return !isBlockedIPv4(octets);
  }

  // DNS name: ≥2 labels, each [a-z0-9-], no leading/trailing hyphen, TLD alphabetic ≥2.
  if (host.length > 253) return false;
  if (host.endsWith(".")) return false;
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
  }
  const tld = labels[labels.length - 1] ?? "";
  if (tld.length < 2 || !/^[a-z]+$/.test(tld)) return false;

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

function clampTitle(title: string): string {
  if (title.length <= TITLE_CARD_MAX) return title;
  return title.slice(0, TITLE_CARD_MAX);
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

function charsetOf(contentTypeHeader: string | null): string {
  if (!contentTypeHeader) return "utf-8";
  const m = /;\s*charset\s*=\s*("?)([^";\s]+)\1/i.exec(contentTypeHeader);
  if (!m) return "utf-8";
  const label = m[2].trim().toLowerCase();
  return label || "utf-8";
}

/**
 * Decode response body with charset awareness when arrayBuffer + TextDecoder
 * exist; fall back to response.text(). byteLength is gated against BODY_HARD_CAP
 * before decoding (cheap on runtimes that already buffered).
 */
async function readResponseBody(
  response: Response,
  contentTypeHeader: string | null,
  onTooLarge: () => void,
): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean; message?: string }> {
  const hasArrayBuffer = typeof (response as { arrayBuffer?: unknown }).arrayBuffer === "function";
  const hasTextDecoder = typeof TextDecoder !== "undefined";

  if (hasArrayBuffer && hasTextDecoder) {
    try {
      const buf = await (response as Response).arrayBuffer();
      if (buf.byteLength > BODY_HARD_CAP) {
        onTooLarge();
        return { ok: false, tooLarge: true };
      }
      const charset = charsetOf(contentTypeHeader);
      try {
        const text = new TextDecoder(charset).decode(buf);
        return { ok: true, text };
      } catch {
        // Unsupported label must not throw out of the tool — retry as utf-8.
        const text = new TextDecoder("utf-8").decode(buf);
        return { ok: true, text };
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { ok: false, tooLarge: false, message: "abort" };
      }
      return {
        ok: false,
        tooLarge: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Fallback path (older RN / incomplete Response mock).
  try {
    const raw = await response.text();
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    if (text.length > BODY_HARD_CAP) {
      return { ok: true, text: text.slice(0, BODY_HARD_CAP) };
    }
    return { ok: true, text };
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, tooLarge: false, message: "abort" };
    }
    return {
      ok: false,
      tooLarge: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
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

    // Fetch exactly the normalized form used for allowlist comparison.
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
          // Manual combine when AbortSignal.any is unavailable (RN path).
          const manual = new AbortController();
          const onAbort = () => manual.abort();
          signal.addEventListener("abort", onAbort, { once: true });
          timeoutController.signal.addEventListener("abort", onAbort, { once: true });
          combined = manual.signal;
        }
      }

      let response: Response;
      try {
        // redirect: native default follows; we re-validate response.url after.
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

      // Empty response.url falls back to the requested url (fail-safe).
      // Never read body on policy refusal.
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

      const contentTypeHeader = response.headers?.get?.("content-type") ?? null;
      const mediaType = mediaTypeOf(contentTypeHeader);
      if (mediaType && !ALLOWED_CONTENT_TYPES.has(mediaType)) {
        return {
          text: errors.webFetchUnsupportedContent.replace("{type}", mediaType),
        };
      }

      // Content-Length early exit only — on RN the transport may already have
      // buffered the body; this is not an OOM mitigation (see module header).
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

      const bodyResult = await readResponseBody(response, contentTypeHeader, () => {
        try {
          timeoutController.abort();
        } catch {
          /* ignore */
        }
      });

      if (!bodyResult.ok) {
        if (bodyResult.tooLarge) {
          const sizeKb = Math.max(1, Math.ceil(BODY_HARD_CAP / 1024));
          return {
            text: errors.webFetchTooLarge.replace("{sizeKb}", String(sizeKb)),
          };
        }
        if (bodyResult.message === "abort") {
          return { text: errors.webFetchTimeout };
        }
        return {
          text: errors.webFetchFailed.replace(
            "{message}",
            bodyResult.message ?? "read failed",
          ),
        };
      }

      let bodyText = bodyResult.text;
      if (bodyText.length > BODY_HARD_CAP) {
        bodyText = bodyText.slice(0, BODY_HARD_CAP);
      }

      const isPlain = mediaType === "text/plain";
      let title: string | null = null;
      let pageText: string;
      if (isPlain) {
        // Cap index input explicitly (content beyond MAX_INDEX_CHARS is not searched).
        pageText =
          bodyText.length > MAX_INDEX_CHARS
            ? bodyText.slice(0, MAX_INDEX_CHARS)
            : bodyText;
      } else {
        // Pass maxChars so the 120k cap is visible at the call site (not a hidden default).
        const extracted = htmlToText(bodyText, MAX_INDEX_CHARS);
        title = extracted.title;
        pageText = extracted.text;
      }

      const index = new DocRetrieverIndex();
      index.append([{ docId: finalUrl, title: title ?? undefined, text: pageText }]);
      const { passages, trace } = runRetrievalLoop(index, query, {
        budgetChars: RETRIEVAL_BUDGET_CHARS,
      });

      const pageHost = hostOf(finalUrl);
      const displayTitle = clampTitle(title ?? pageHost);

      // Char n-grams can score weak BM25 hits with zero content-word coverage;
      // treat coverage 0 (or no passages) as nothing-matched.
      // No sources on this path — no cite instruction / source card.
      // Use host (not untrusted <title>) inside the directive message.
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

      // Cite instruction is appended by LlamaService with absolute source numbers
      // and kind "passages" so the model does not treat passage indices as sources.
      return { text: body, sources };
    } finally {
      clearTimeout(timer);
    }
  };
}

