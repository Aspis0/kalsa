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
 * (HTML, text/plain, and PDF page docs); content beyond that is not indexed.
 *
 * Pure enough for the Node harness: no LlamaService / React Native imports.
 * Catalog strings come from en/it directly so tsc --ignoreConfig stays RN-free.
 *
 * PDF path (optional): when `extractPdfText` is injected, `application/pdf` is
 * accepted. The executor stays React-free — the app supplies the extractor
 * (WebView host via requestPdfText) and a cache FS. Without the extractor, PDF
 * responses keep today's unsupported-content behaviour (no hidden fallbacks).
 *
 * Accepted limitations (audit):
 * - Abort-signal listener fan-in when AbortSignal.any is missing is bounded by
 *   the turn (one manual combine per fetch); not a process-lifetime leak.
 * - On React Native the whole body is buffered by the transport (XHR) before
 *   JavaScript sees it, so a Content-Length pre-check is only an early exit —
 *   a hostile allowlisted host can still exhaust memory within FETCH_TIMEOUT_MS
 *   (HTML) or PDF_FETCH_TIMEOUT_MS (when the PDF extractor is wired). These caps
 *   are an early exit, not real memory protection. A real fix needs a native
 *   streaming module. Do not claim otherwise.
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
  /** Distinct PDF page numbers present in this outcome (cite instruction). */
  pdfPages?: number[];
};

export type WebFetchToolResult = {
  text: string;
  sources?: WebFetchSource[];
};

/** Docs returned by the injected PDF text extractor (matches pdfPagesToRetrievalDocs). */
export type PdfTextExtractResult = {
  docs: Array<{ docId: string; title?: string; text: string }>;
  skippedPages: number[];
  /** Real document page count (uncapped), when known. */
  documentPageCount?: number;
};

export type ExtractPdfTextFn = (
  fileUri: string,
  opts?: {
    sourceId?: string;
    title?: string | null;
    signal?: AbortSignal;
  },
) => Promise<PdfTextExtractResult>;

/**
 * Cache FS for the PDF body. Injected so the harness can observe write/delete
 * and the production app can use expo-file-system without RN imports here.
 */
export type PdfCacheFs = {
  /** Persist bytes; return a file URI the extractor can open. */
  write(bytes: Uint8Array): Promise<string>;
  /** Best-effort delete (success, error, and timeout paths all call this). */
  remove(fileUri: string): Promise<void>;
};

/** Shorter download window for HTML/plain; does not bound peak memory on RN (see header). */
export const FETCH_TIMEOUT_MS = 8_000;
/** Declared Content-Length / post-read byteLength hard stop for HTML/plain. */
export const BODY_HARD_CAP = 1_500_000;
/**
 * PDF download body cap — matches PdfToImages DEFAULT_MAX_BYTES (5 MB).
 * On RN the whole body is buffered by the transport before JS sees it, so this
 * is an early exit only, not real memory protection (see module header).
 */
export const PDF_BODY_HARD_CAP = 5 * 1024 * 1024;
/**
 * PDF **network** timeout only (download body), not extraction.
 * Chosen from the URL path (and re-derived from the final URL after redirects
 * when the final path looks like a PDF). Extraction runs after the body is
 * fully read under the turn abort signal + the PdfTextService/component
 * timeouts (up to ~160s) — not under this window.
 * Same RN buffering caveat as PDF_BODY_HARD_CAP.
 *
 * Limitation: a non-`.pdf` URL that redirects to a PDF re-arms only when the
 * response arrives (cheap); time already spent counts against the new window
 * only from re-arm. Encoded `.` (`%2E`) and path parameters after `;` are
 * normalised in `urlPathLooksLikePdf`.
 */
export const PDF_FETCH_TIMEOUT_MS = 20_000;
/**
 * Max chars fed into the retrieval index (HTML, text/plain, and PDF page docs).
 * Content beyond this is not searched. Matches htmlToText's default output cap
 * and the WEB_FETCH_TOOL description.
 */
export const MAX_INDEX_CHARS = 120_000;
export const RETRIEVAL_BUDGET_CHARS = 1800;
const TITLE_CARD_MAX = 120;

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

const PDF_MEDIA_TYPE = "application/pdf";

/** Extract http(s) URLs from free text (user messages). */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;

export const WEB_FETCH_TOOL: WebFetchToolDef = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch a web page or a PDF the model has seen in search results (or that the user pasted) and extract the passages relevant to a query. PDF text is extracted per page; passages are labeled with their page number. A scanned PDF with no text layer cannot be read (the tool says so). Only the first ~120k characters of page text are searched.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Web page or PDF URL to fetch — must be a search result or a link the user provided.",
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

/**
 * True when the URL *path* (query and fragment stripped) ends with `.pdf`
 * case-insensitively. Used only to pick the network timeout before headers
 * arrive — not a content-type gate. A query like `?file=a.pdf` does NOT match.
 * Decodes percent-encoding (`%2Epdf` → `.pdf`) and strips path parameters after
 * `;` (`a.pdf;x=1` → `a.pdf`).
 */
export function urlPathLooksLikePdf(url: string): boolean {
  if (typeof url !== "string" || !url) return false;
  // Strip fragment, then query, then take the path after the authority.
  let s = url.trim();
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  // Path is everything after scheme://authority, or the whole remainder.
  const schemeEnd = s.indexOf("://");
  let path = s;
  if (schemeEnd >= 0) {
    const afterScheme = s.slice(schemeEnd + 3);
    const slash = afterScheme.indexOf("/");
    path = slash >= 0 ? afterScheme.slice(slash) : "";
  }
  // No path component (e.g. https://host) is not a PDF URL for timeout purposes.
  if (!path) return false;
  // Path parameters (RFC 3986 matrix-style): strip `;…` only inside the last
  // segment so `/dir;param/file.pdf` stays a PDF URL (8s vs 20s regression).
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  let lastSeg = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const semi = lastSeg.indexOf(";");
  if (semi >= 0) lastSeg = lastSeg.slice(0, semi);
  path = dir + lastSeg;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep raw path if malformed encoding */
  }
  return path.toLowerCase().endsWith(".pdf");
}

/**
 * Network deadline for a fetch URL. Independent of whether extractPdfText is
 * wired — see comment at the call site in makeWebFetchExecutor.
 */
export function resolveFetchNetworkTimeoutMs(url: string): number {
  return urlPathLooksLikePdf(url) ? PDF_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
}

/** Effective host:port key (scheme default port filled in) for origin equality. */
function hostPortKey(url: string): string | null {
  const host = extractHttpHost(url);
  if (host == null) return null;
  const scheme = extractScheme(url);
  const m = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(url.trim());
  let explicitPort: string | null = null;
  if (m) {
    let authority = m[1];
    const at = authority.lastIndexOf("@");
    if (at >= 0) authority = authority.slice(at + 1);
    // Ignore the colon inside a bracketed IPv6 authority.
    if (!authority.startsWith("[")) {
      const colon = authority.lastIndexOf(":");
      if (colon >= 0 && /^\d+$/.test(authority.slice(colon + 1))) {
        explicitPort = authority.slice(colon + 1);
      }
    }
  }
  const port = explicitPort ?? (scheme === "http" ? "80" : scheme === "https" ? "443" : "");
  return `${host}:${port}`;
}

/**
 * Same-origin (host AND effective port) equality — used to re-validate a
 * followed redirect. Port-aware so a server-driven redirect cannot hop from
 * `example.com:443` to `example.com:2222` and have its body read (the port was
 * the last widening left in the final-URL gate). No suffix matching.
 */
export function sameHost(a: string, b: string): boolean {
  const ka = hostPortKey(a);
  const kb = hostPortKey(b);
  return ka != null && kb != null && ka === kb;
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
  // Same hard-error behaviour as the arrayBuffer path — never silent truncate.
  try {
    const raw = await response.text();
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    // Prefer a true byte measurement when TextEncoder exists (UTF-16 length ≠ bytes).
    if (typeof TextEncoder !== "undefined") {
      const byteLength = new TextEncoder().encode(text).byteLength;
      if (byteLength > BODY_HARD_CAP) {
        onTooLarge();
        return { ok: false, tooLarge: true };
      }
    } else if (text.length > BODY_HARD_CAP) {
      // Cannot measure bytes — fail closed with the same hard error (not truncate).
      onTooLarge();
      return { ok: false, tooLarge: true };
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
  /**
   * When present, `application/pdf` responses are accepted and routed here.
   * When absent, PDF keeps `webFetchUnsupportedContent` (no hidden fallback).
   * Must stay free of React — production wires requestPdfText from the host.
   */
  extractPdfText?: ExtractPdfTextFn;
  /** Required for the PDF path when extractPdfText is set (write body + finally delete). */
  pdfCacheFs?: PdfCacheFs;
  /**
   * Single-flight pre-check (H3). When true for a PDF URL / PDF response, the
   * executor returns webFetchPdfBusy without fetching or reading the body.
   * Production wires isPdfTextExtractionBusy from pdfTextService.
   */
  isPdfTextExtractionBusy?: () => boolean;
  /**
   * Harness override for the network deadline (ms) resolution. Production leaves
   * this unset so path-based resolveFetchNetworkTimeoutMs is used. Lets contracts
   * pin clearNetworkTimer / both-aborted precedence with short windows.
   */
  resolveNetworkTimeoutMs?: (url: string) => number;
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
  const extractPdfText = deps?.extractPdfText;
  const pdfCacheFs = deps?.pdfCacheFs;
  const isBusy = deps?.isPdfTextExtractionBusy;
  const resolveTimeout =
    deps?.resolveNetworkTimeoutMs ?? resolveFetchNetworkTimeoutMs;
  const pdfPathEnabled = typeof extractPdfText === "function";

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

    // H3: refuse a concurrent PDF before any network call when the path looks
    // like a PDF (single-flight is in the service, reached only after download
    // otherwise — wasteful on mobile).
    if (
      pdfPathEnabled &&
      urlPathLooksLikePdf(url) &&
      typeof isBusy === "function" &&
      isBusy()
    ) {
      return { text: errors.webFetchPdfBusy };
    }

    // Network timeout from the URL path, not from "extractor wired".
    // On RN the transport buffers the whole body before JS sees headers, so we
    // cannot peek at Content-Type and then extend the deadline. Using the long
    // PDF window whenever extractPdfText is present would make every HTML fetch
    // wait up to 20s (the 8s cap was deliberately lowered for phone UX).
    // Rule: path ends in ".pdf" → PDF timeout; otherwise FETCH_TIMEOUT_MS.
    // Re-derived from finalUrl after redirects (M2). No HEAD pre-flight.
    let networkTimeoutMs = resolveTimeout(url);
    const timeoutController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => timeoutController.abort(),
      networkTimeoutMs,
    );
    const clearNetworkTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const rearmNetworkTimer = (ms: number) => {
      clearNetworkTimer();
      networkTimeoutMs = ms;
      timer = setTimeout(() => timeoutController.abort(), ms);
    };

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

      const abortMessage = (preferPdf: boolean): string => {
        // User stop wins even when the network timer also aborted (both-aborted).
        // A user stop must never say "try again".
        if (signal?.aborted) {
          return preferPdf ? errors.webFetchPdfAborted : errors.webFetchAborted;
        }
        return preferPdf ? errors.webFetchPdfTimeout : errors.webFetchTimeout;
      };

      let response: Response;
      try {
        // redirect: native default follows; we re-validate response.url after.
        response = await fetchImpl(url, {
          signal: combined,
          redirect: "follow",
        });
      } catch (error) {
        if (isAbortError(error) || combined.aborted || timeoutController.signal.aborted) {
          return {
            text: abortMessage(urlPathLooksLikePdf(url)),
          };
        }
        return {
          text: errors.webFetchFailed.replace(
            "{message}",
            sanitizeToolErrorMessage(
              error instanceof Error ? error.message : String(error),
            ),
          ),
        };
      }

      // Empty response.url falls back to the requested url (fail-safe).
      // Never read body on policy refusal.
      const finalUrl =
        typeof response.url === "string" && response.url.trim() ? response.url.trim() : url;

      const finalPublic = isPubliclyRoutableHttpUrl(finalUrl);
      const requestedScheme = extractScheme(url);
      const finalScheme = extractScheme(finalUrl);
      // sameHost is port-aware (same-scheme origin equality). Also allow a
      // same-HOST http→https upgrade redirect (common 301) without loosening
      // sameHost — a same-scheme port hop (:443→:2222) still fails sameHost
      // and is not an upgrade, so it stays refused. https→http is still blocked.
      const hostA = extractHttpHost(finalUrl);
      const hostB = extractHttpHost(url);
      const httpToHttpsUpgrade =
        requestedScheme === "http" &&
        finalScheme === "https" &&
        hostA != null &&
        hostB != null &&
        hostA === hostB;
      const finalAllowed =
        allowlist.has(finalUrl) || sameHost(finalUrl, url) || httpToHttpsUpgrade;
      const downgrade =
        requestedScheme === "https" && finalScheme !== null && finalScheme !== "https";

      if (!finalPublic || !finalAllowed || downgrade) {
        return { text: errors.webFetchBlockedRedirect };
      }

      // M2: re-derive network window from the final URL after redirects.
      const finalNetworkMs = resolveTimeout(finalUrl);
      if (finalNetworkMs !== networkTimeoutMs && !timeoutController.signal.aborted) {
        rearmNetworkTimer(finalNetworkMs);
        // Rebuild combined so a late network abort still reaches body reads.
        if (signal) {
          if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
            combined = AbortSignal.any([signal, timeoutController.signal]);
          }
        } else {
          combined = timeoutController.signal;
        }
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          text: errors.webFetchHttpError.replace("{status}", String(response.status)),
        };
      }

      const contentTypeHeader = response.headers?.get?.("content-type") ?? null;
      const mediaType = mediaTypeOf(contentTypeHeader);
      const isPdf = mediaType === PDF_MEDIA_TYPE;

      if (mediaType && !ALLOWED_CONTENT_TYPES.has(mediaType)) {
        if (!(isPdf && pdfPathEnabled)) {
          return {
            text: errors.webFetchUnsupportedContent.replace("{type}", mediaType),
          };
        }
      }

      // ── PDF path ──────────────────────────────────────────────────────────
      if (isPdf && pdfPathEnabled) {
        // H3: busy after CT confirm (non-.pdf URL that served a PDF).
        if (typeof isBusy === "function" && isBusy()) {
          return { text: errors.webFetchPdfBusy };
        }
        return await handlePdfResponse({
          response,
          finalUrl,
          query,
          errors,
          extractPdfText: extractPdfText as ExtractPdfTextFn,
          pdfCacheFs,
          turnSignal: signal,
          timeoutController,
          clearNetworkTimer,
        });
      }

      // ── HTML / plain path ─────────────────────────────────────────────────
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
            text: errors.webFetchTooLargeMeasured.replace("{sizeKb}", String(sizeKb)),
          };
        }
        if (bodyResult.message === "abort") {
          return { text: abortMessage(false) };
        }
        return {
          text: errors.webFetchFailed.replace(
            "{message}",
            sanitizeToolErrorMessage(bodyResult.message ?? "read failed"),
          ),
        };
      }

      const bodyText = bodyResult.text;
      // readResponseBody already hard-errors over BODY_HARD_CAP (both paths).

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
      clearNetworkTimer();
    }
  };
}

type ErrorCatalog = ReturnType<typeof catalog>["errors"];

async function handlePdfResponse(ctx: {
  response: Response;
  finalUrl: string;
  query: string;
  errors: ErrorCatalog;
  extractPdfText: ExtractPdfTextFn;
  pdfCacheFs: PdfCacheFs | undefined;
  /** Caller's turn signal only — used for extraction after network timer clears. */
  turnSignal: AbortSignal | undefined;
  timeoutController: AbortController;
  /** End the network deadline once the body is fully buffered. */
  clearNetworkTimer: () => void;
}): Promise<WebFetchToolResult> {
  const {
    response,
    finalUrl,
    query,
    errors,
    extractPdfText,
    pdfCacheFs,
    turnSignal,
    timeoutController,
    clearNetworkTimer,
  } = ctx;

  // Content-Length early exit — same RN buffering caveat as HTML (see header).
  const clRaw = response.headers?.get?.("content-length");
  if (clRaw != null && clRaw !== "") {
    const declared = Number(clRaw);
    if (Number.isFinite(declared) && declared > PDF_BODY_HARD_CAP) {
      try {
        timeoutController.abort();
      } catch {
        /* ignore */
      }
      const sizeKb = Math.max(1, Math.ceil(declared / 1024));
      return {
        text: errors.webFetchPdfTooLarge.replace("{sizeKb}", String(sizeKb)),
      };
    }
  }

  if (!pdfCacheFs || typeof pdfCacheFs.write !== "function") {
    return {
      text: errors.webFetchPdfExtractFailed.replace(
        "{message}",
        "PDF cache filesystem is not configured",
      ),
    };
  }

  const bytesResult = await readResponseBytes(response, PDF_BODY_HARD_CAP, () => {
    try {
      timeoutController.abort();
    } catch {
      /* ignore */
    }
  });

  if (!bytesResult.ok) {
    if (bytesResult.tooLarge) {
      const sizeKb = Math.max(
        1,
        Math.ceil((bytesResult.byteLength ?? PDF_BODY_HARD_CAP) / 1024),
      );
      return {
        text: errors.webFetchPdfTooLargeMeasured.replace("{sizeKb}", String(sizeKb)),
      };
    }
    if (bytesResult.message === "abort") {
      // User stop wins over network timer when both are aborted.
      if (turnSignal?.aborted) {
        return { text: errors.webFetchPdfAborted };
      }
      return { text: errors.webFetchPdfTimeout };
    }
    return {
      text: errors.webFetchFailed.replace(
        "{message}",
        sanitizeToolErrorMessage(bytesResult.message ?? "read failed"),
      ),
    };
  }

  // H1: body fully read — network window ends. Extraction uses the turn signal
  // plus the service/component timeouts (not the 8s/20s download deadline).
  clearNetworkTimer();

  let cacheUri: string | null = null;
  try {
    try {
      cacheUri = await pdfCacheFs.write(bytesResult.bytes);
    } catch (error) {
      // H2: never throw; never leak filesystem paths into the model prompt.
      return {
        text: errors.webFetchPdfExtractFailed.replace(
          "{message}",
          sanitizeToolErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
        ),
      };
    }

    let extracted: PdfTextExtractResult;
    try {
      extracted = await extractPdfText(cacheUri, {
        // sourceId is remapped below to finalUrl; pass host-safe hint only.
        sourceId: hostOf(finalUrl),
        title: null,
        // Turn signal only — network timer already cleared.
        signal: turnSignal,
      });
    } catch (error) {
      return mapPdfExtractError(error, errors, {
        turnAborted: Boolean(turnSignal?.aborted),
      });
    }

    const docs = Array.isArray(extracted?.docs) ? extracted.docs : [];
    const skippedPages = Array.isArray(extracted?.skippedPages)
      ? extracted.skippedPages.filter(
          (p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1,
        )
      : [];
    // Pre-cap extraction counts — used only to clamp documentPageCount.
    const extractedProcessed = docs.length + skippedPages.length;
    // pdf.numPages is attacker-controlled; never print a count below what we
    // actually extracted, and hedge the copy ("reports") in i18n.
    let documentPageCount: number | null =
      typeof extracted?.documentPageCount === "number" &&
      Number.isInteger(extracted.documentPageCount) &&
      extracted.documentPageCount >= 1
        ? extracted.documentPageCount
        : extractedProcessed > 0
          ? extractedProcessed
          : null;
    if (documentPageCount != null && extractedProcessed > 0) {
      documentPageCount = Math.max(documentPageCount, extractedProcessed);
    }

    // Remap docIds onto the fetched URL (never a filesystem path) so passages
    // carry `${url}#pN` and citations point at the remote source.
    // maxPage rejects over-range #pN (defence in depth; producer always clamps).
    const remapped = remapPdfDocsToSourceUrl(docs, finalUrl, {
      maxPage: documentPageCount ?? extractedProcessed,
    });
    // L: apply the same MAX_INDEX_CHARS budget the tool description advertises.
    const capResult = capDocsForIndex(remapped, MAX_INDEX_CHARS);
    const urlDocs = capResult.docs;
    // Message counts from the POST-cap set: dropped pages were never searched.
    const processed = urlDocs.length + skippedPages.length;

    const indexCapNote =
      capResult.droppedCount > 0 || capResult.lastTruncated
        ? errors.webFetchPdfIndexCapped
            .replace("{dropped}", String(capResult.droppedCount))
            .replace(
              "{pageList}",
              capResult.droppedPageNumbers.length > 0
                ? capResult.droppedPageNumbers.join(", ")
                : "none",
            )
        : null;

    if (urlDocs.length === 0 && docs.length === 0) {
      if (skippedPages.length > 0) {
        const pages = documentPageCount ?? skippedPages.length;
        return {
          text: errors.webFetchPdfNoTextLayer
            .replace("{pages}", String(pages))
            .replace("{processed}", String(processed || skippedPages.length)),
          sources: [],
        };
      }
      return { text: errors.webFetchPdfInvalid, sources: [] };
    }

    if (urlDocs.length === 0) {
      // All text was dropped by the index cap — nothing searchable, but say so.
      let text = errors.webFetchNothingMatched.replace("{host}", hostOf(finalUrl));
      if (indexCapNote) text += "\n\n" + indexCapNote;
      return { text, sources: [] };
    }

    const index = new DocRetrieverIndex();
    index.append(
      urlDocs.map((d) => ({
        docId: d.docId,
        title: d.title,
        text: d.text,
      })),
    );
    const { passages, trace } = runRetrievalLoop(index, query, {
      budgetChars: RETRIEVAL_BUDGET_CHARS,
    });

    const pageHost = hostOf(finalUrl);
    const lastCoverage =
      trace.coverageByRound.length > 0
        ? (trace.coverageByRound[trace.coverageByRound.length - 1] ?? 0)
        : 0;
    if (!passages.length || lastCoverage <= 0) {
      let text = errors.webFetchNothingMatched.replace("{host}", pageHost);
      // Never fire "nothing matched" silently when pages went unsearched.
      if (indexCapNote) text += "\n\n" + indexCapNote;
      return { text, sources: [] };
    }

    const pdfPages = pagesFromDocIds(passages.map((p) => p.docId));
    const displayTitle = clampTitle(pageHost);
    const sources: WebFetchSource[] = [
      {
        title: displayTitle,
        url: finalUrl,
        provider: "fetch",
        pdfPages: pdfPages.length > 0 ? pdfPages : undefined,
      },
    ];

    let body = passages
      .map((p, i) => {
        const page = pageFromDocId(p.docId);
        const label = page != null ? ` (p. ${page})` : "";
        return `${i + 1}.${label} ${p.text}`;
      })
      .join("\n\n");

    if (skippedPages.length > 0) {
      const pages = documentPageCount ?? processed;
      body +=
        "\n\n" +
        errors.webFetchPdfSkippedPages
          .replace("{skipped}", String(skippedPages.length))
          .replace("{processed}", String(processed))
          .replace("{pages}", String(pages));
    }

    if (indexCapNote) {
      body += "\n\n" + indexCapNote;
    }

    return { text: body, sources };
  } finally {
    if (cacheUri && pdfCacheFs) {
      try {
        await pdfCacheFs.remove(cacheUri);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/**
 * Map extractor failures. Prefer `code` on PdfTextServiceError — never remap
 * arbitrary pdf.js messages that happen to contain "timed out".
 */
function mapPdfExtractError(
  error: unknown,
  errors: ErrorCatalog,
  opts?: { turnAborted?: boolean },
): WebFetchToolResult {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);

  if (code === "no_host") {
    return { text: errors.webFetchPdfHostMissing };
  }
  if (code === "busy") {
    return { text: errors.webFetchPdfBusy };
  }
  if (code === "timeout") {
    return { text: errors.webFetchPdfExtractTimeout };
  }
  if (code === "renderer_gone") {
    // Document too large/hostile for the device — never "try again".
    return { text: errors.webFetchPdfRendererGone };
  }
  if (code === "aborted" || code === "unmounted") {
    // User stop / host teardown — never "try again".
    return { text: errors.webFetchPdfAborted };
  }
  if (isAbortError(error) || opts?.turnAborted) {
    return { text: errors.webFetchPdfAborted };
  }
  return {
    text: errors.webFetchPdfExtractFailed.replace(
      "{message}",
      sanitizeToolErrorMessage(message),
    ),
  };
}

/**
 * Strip path-like tokens and truncate before injecting into model-facing text.
 * Prevents cache paths / ENOSPC strings from leaking into the prompt (H2).
 * http(s) URLs are preserved intact (parked while path rules run) so the model
 * still sees which URL failed. Linear replacements only — no nested quantifiers.
 */
export function sanitizeToolErrorMessage(raw: string): string {
  let s = typeof raw === "string" ? raw : String(raw ?? "");
  s = s.replace(/\r?\n/g, " ").trim();

  // Park http(s) URLs so path rules cannot eat `/a/b` after the authority.
  const parked: string[] = [];
  s = s.replace(/https?:\/\/[^\s<>"']+/gi, (m) => {
    const i = parked.length;
    parked.push(m);
    return `\u0000URL${i}\u0000`;
  });

  // file:// URIs (full) — not parked; strip as paths.
  s = s.replace(/file:\/\/[^\s]+/gi, "[path]");
  // Percent-encoded absolute paths (%2Fdata%2Fuser%2F…)
  s = s.replace(
    /(?:%2[fF])(?:[\w.-]|%[0-9A-Fa-f]{2}){2,}(?:%2[fF](?:[\w.-]|%[0-9A-Fa-f]{2})+)*/g,
    "[path]",
  );
  // Known absolute roots (POSIX app / system)
  s = s.replace(/\/(?:data|var|tmp|private|Users|home|storage)\/[^\s]+/gi, "[path]");
  // Windows drive paths
  s = s.replace(/[A-Za-z]:\\[^\s]+/g, "[path]");
  // UNC paths \\server\share\…
  s = s.replace(/\\\\[^\s]+/g, "[path]");
  // Generic multi-segment absolute path. Do not match:
  // - immediately after `:` (e.g. `file:` leftovers already handled)
  // - the second slash of a `scheme://` URI (`content://media/...` would
  //   otherwise become `content:/[path]` because offset-1 is `/`, not `:`).
  s = s.replace(/\/[\w.-]+(?:\/[\w.-]+){2,}/g, (match, offset, full) => {
    if (typeof offset === "number" && offset > 0) {
      if (full[offset - 1] === ":") return match;
      if (
        full[offset - 1] === "/" &&
        offset >= 2 &&
        full[offset - 2] === ":"
      ) {
        return match;
      }
    }
    return "[path]";
  });

  // Restore parked http(s) URLs.
  s = s.replace(/\u0000URL(\d+)\u0000/g, (_, idx) => parked[Number(idx)] ?? "");

  if (s.length > 160) s = s.slice(0, 160) + "…";
  return s.length > 0 ? s : "unknown error";
}

/** Result of capping PDF page docs to the searchable index budget. */
export type CapDocsForIndexResult = {
  docs: Array<{ docId: string; title?: string; text: string }>;
  /** Whole docs dropped after the budget was exhausted. */
  droppedCount: number;
  /** Page numbers (from #pN) of dropped docs; may be shorter than droppedCount. */
  droppedPageNumbers: number[];
  /** True if the last kept doc was sliced to fit the remaining budget. */
  lastTruncated: boolean;
};

/** Cap total indexed PDF text to MAX_INDEX_CHARS (tool description promise). */
export function capDocsForIndex(
  docs: Array<{ docId: string; title?: string; text: string }>,
  maxChars: number,
): CapDocsForIndexResult {
  const empty = (dropped: number, pages: number[]): CapDocsForIndexResult => ({
    docs: [],
    droppedCount: dropped,
    droppedPageNumbers: pages,
    lastTruncated: false,
  });
  if (!Array.isArray(docs) || maxChars <= 0) {
    if (!Array.isArray(docs)) return empty(0, []);
    const pages: number[] = [];
    let n = 0;
    for (const d of docs) {
      if (!d || typeof d.text !== "string" || !d.text) continue;
      n++;
      const p = pageFromDocId(typeof d.docId === "string" ? d.docId : "");
      if (p != null) pages.push(p);
    }
    return empty(n, pages);
  }
  let remaining = maxChars;
  const out: Array<{ docId: string; title?: string; text: string }> = [];
  let lastTruncated = false;
  let i = 0;
  for (; i < docs.length; i++) {
    if (remaining <= 0) break;
    const d = docs[i];
    const text = typeof d?.text === "string" ? d.text : "";
    if (!text) continue;
    if (text.length <= remaining) {
      out.push({ docId: d.docId, title: d.title, text });
      remaining -= text.length;
    } else {
      out.push({ docId: d.docId, title: d.title, text: text.slice(0, remaining) });
      remaining = 0;
      lastTruncated = true;
      i++; // this doc was kept (truncated); remaining docs are dropped
      break;
    }
  }
  const droppedPageNumbers: number[] = [];
  let droppedCount = 0;
  for (let j = i; j < docs.length; j++) {
    const d = docs[j];
    if (!d || typeof d.text !== "string" || !d.text) continue;
    droppedCount++;
    const p = pageFromDocId(typeof d.docId === "string" ? d.docId : "");
    if (p != null) droppedPageNumbers.push(p);
  }
  return { docs: out, droppedCount, droppedPageNumbers, lastTruncated };
}

/**
 * Read response body as bytes with a hard byteLength gate.
 * Never decodes as text (PDF is binary).
 */
async function readResponseBytes(
  response: Response,
  hardCap: number,
  onTooLarge: () => void,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; tooLarge: boolean; byteLength?: number; message?: string }
> {
  const hasArrayBuffer = typeof (response as { arrayBuffer?: unknown }).arrayBuffer === "function";
  if (!hasArrayBuffer) {
    // Fallback: older mocks may only expose text() — treat as latin1 bytes.
    try {
      const raw = await response.text();
      const text = typeof raw === "string" ? raw : String(raw ?? "");
      if (text.length > hardCap) {
        onTooLarge();
        return { ok: false, tooLarge: true, byteLength: text.length };
      }
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xff;
      }
      return { ok: true, bytes };
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

  try {
    const buf = await (response as Response).arrayBuffer();
    if (buf.byteLength > hardCap) {
      onTooLarge();
      return { ok: false, tooLarge: true, byteLength: buf.byteLength };
    }
    return { ok: true, bytes: new Uint8Array(buf) };
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

/**
 * Rebuild docIds as `${sourceUrl}#pN` from extractor output.
 * - Missing #pN → no page label (docId = sourceUrl only); never invent page 1.
 * - page > maxPage (when set) → doc is dropped (defence in depth).
 */
export function remapPdfDocsToSourceUrl(
  docs: Array<{ docId: string; title?: string; text: string }>,
  sourceUrl: string,
  opts?: { maxPage?: number },
): Array<{ docId: string; title?: string; text: string }> {
  const maxPage =
    typeof opts?.maxPage === "number" &&
    Number.isInteger(opts.maxPage) &&
    opts.maxPage >= 1
      ? opts.maxPage
      : null;
  const out: Array<{ docId: string; title?: string; text: string }> = [];
  for (const d of docs) {
    if (!d || typeof d.text !== "string" || d.text.length === 0) continue;
    const page = pageFromDocId(typeof d.docId === "string" ? d.docId : "");
    if (page == null) {
      // No inventing "#p1" — passages will carry no "(p. N)" label.
      out.push({ docId: sourceUrl, title: d.title, text: d.text });
      continue;
    }
    if (maxPage != null && page > maxPage) {
      continue; // reject out-of-range page numbers
    }
    out.push({
      docId: `${sourceUrl}#p${page}`,
      title: d.title,
      text: d.text,
    });
  }
  return out;
}

export function pageFromDocId(docId: string): number | null {
  if (typeof docId !== "string") return null;
  const m = /#p(\d+)$/.exec(docId);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function pagesFromDocIds(docIds: string[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of docIds) {
    const p = pageFromDocId(id);
    if (p == null || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  out.sort((a, b) => a - b);
  return out;
}

