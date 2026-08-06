/**
 * PDF text extraction service — bridges the React-free tool loop to a mounted
 * PdfToImages WebView host (see PdfTextExtractorHost).
 *
 * Architectural constraint: tool executors run inside LlamaService, not React.
 * Extraction needs a mounted WebView, so the host registers a bridge and the
 * executor calls `requestPdfText` (an injected async function).
 *
 * Single-flight: concurrent `requestPdfText` calls are REJECTED (not queued).
 * Rationale: a phone can barely hold one PDF WebView + decoded page state in
 * memory; queuing would keep extra file URIs and extraction state alive while
 * another PDF is still open. The tool loop gets a clear busy error instead of
 * an unbounded wait that compounds memory pressure.
 *
 * If no host is mounted, reject immediately — never hang the tool loop.
 * A module-level hard timeout is a backstop above the component's per-page /
 * total timers; after timeout the WebView is unmounted and late resolve/reject
 * is a no-op.
 *
 * Pure enough for a Node harness of the protocol (host injection); no React
 * imports in this module.
 */

import type { PdfRetrievalDocsResult } from "../util/pdfText";

/** Slightly above PdfToImages TOTAL_EXTRACTION_TIMEOUT_MS (150s). */
export const PDF_TEXT_SERVICE_TIMEOUT_MS = 160_000;

export type PdfTextRequestOpts = {
  /** Retrieval source id base (passed through to PdfToImages). */
  sourceId?: string;
  title?: string | null;
  /** Hard backstop timeout; default PDF_TEXT_SERVICE_TIMEOUT_MS. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type PdfExtractionResult = PdfRetrievalDocsResult;

export type PdfTextServiceErrorCode =
  | "no_host"
  | "busy"
  | "timeout"
  | "unmounted"
  | "aborted"
  | "failed";

export class PdfTextServiceError extends Error {
  readonly code: PdfTextServiceErrorCode;

  constructor(code: PdfTextServiceErrorCode, message: string) {
    super(message);
    this.name = "PdfTextServiceError";
    this.code = code;
  }
}

export type PdfTextHostRequest = {
  id: number;
  fileUri: string;
  sourceId?: string;
  title?: string | null;
};

type HostBridge = {
  /** Present a request to the host (or null to unmount the WebView). */
  setRequest: (req: PdfTextHostRequest | null) => void;
};

type Inflight = {
  id: number;
  resolve: (result: PdfExtractionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  onAbort?: () => void;
  signal?: AbortSignal;
};

let host: HostBridge | null = null;
let seq = 0;
let inflight: Inflight | null = null;

export function isPdfTextHostMounted(): boolean {
  return host != null;
}

/** True when an extraction is currently in flight. */
export function isPdfTextExtractionBusy(): boolean {
  return inflight != null && !inflight.settled;
}

/**
 * Called once by PdfTextExtractorHost on mount. Returns an unregister function
 * (call on unmount). If a request is still in flight when the host unmounts,
 * it is rejected with `unmounted`.
 */
export function registerPdfTextHost(bridge: HostBridge): () => void {
  host = bridge;
  return () => {
    if (host === bridge) {
      host = null;
    }
    if (inflight && !inflight.settled) {
      settleReject(
        new PdfTextServiceError(
          "unmounted",
          "PDF text extractor host unmounted during extraction",
        ),
      );
    }
  };
}

/**
 * Request text-layer extraction for a local PDF file URI.
 * Rejects immediately if no host is mounted or another extraction is busy.
 */
export function requestPdfText(
  fileUri: string,
  opts?: PdfTextRequestOpts,
): Promise<PdfExtractionResult> {
  if (typeof fileUri !== "string" || !fileUri.trim()) {
    return Promise.reject(
      new PdfTextServiceError("failed", "Missing PDF file URI"),
    );
  }

  if (!host) {
    return Promise.reject(
      new PdfTextServiceError(
        "no_host",
        "PDF text extractor host is not mounted",
      ),
    );
  }

  if (inflight && !inflight.settled) {
    return Promise.reject(
      new PdfTextServiceError(
        "busy",
        "PDF text extraction already in progress",
      ),
    );
  }

  if (opts?.signal?.aborted) {
    return Promise.reject(
      new PdfTextServiceError("aborted", "PDF text extraction aborted"),
    );
  }

  const id = ++seq;
  const timeoutMs =
    typeof opts?.timeoutMs === "number" &&
    Number.isFinite(opts.timeoutMs) &&
    opts.timeoutMs > 0
      ? opts.timeoutMs
      : PDF_TEXT_SERVICE_TIMEOUT_MS;

  return new Promise<PdfExtractionResult>((resolve, reject) => {
    const entry: Inflight = {
      id,
      resolve,
      reject,
      settled: false,
      timer: setTimeout(() => {
        settleReject(
          new PdfTextServiceError(
            "timeout",
            "PDF text extraction timed out",
          ),
        );
      }, timeoutMs),
      signal: opts?.signal,
    };

    if (opts?.signal) {
      const onAbort = () => {
        settleReject(
          new PdfTextServiceError("aborted", "PDF text extraction aborted"),
        );
      };
      entry.onAbort = onAbort;
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    inflight = entry;

    try {
      host!.setRequest({
        id,
        fileUri: fileUri.trim(),
        sourceId: opts?.sourceId,
        title: opts?.title,
      });
    } catch (error) {
      settleReject(
        error instanceof PdfTextServiceError
          ? error
          : new PdfTextServiceError(
              "failed",
              error instanceof Error ? error.message : String(error),
            ),
      );
    }
  });
}

/** Host delivers a successful extraction for the given request id. */
export function resolvePdfTextRequest(
  id: number,
  result: PdfExtractionResult,
): void {
  if (!inflight || inflight.settled || inflight.id !== id) return;
  const entry = inflight;
  markSettled(entry);
  clearHostRequest();
  entry.resolve(normalizeResult(result));
}

/** Host delivers a failure for the given request id. */
export function rejectPdfTextRequest(id: number, error: unknown): void {
  if (!inflight || inflight.settled || inflight.id !== id) return;
  const err =
    error instanceof PdfTextServiceError
      ? error
      : new PdfTextServiceError(
          "failed",
          error instanceof Error ? error.message : String(error),
        );
  settleReject(err);
}

/** Test-only: reset module state between harness cases. */
export function __resetPdfTextServiceForTests(): void {
  if (inflight) {
    clearTimeout(inflight.timer);
    if (inflight.signal && inflight.onAbort) {
      try {
        inflight.signal.removeEventListener("abort", inflight.onAbort);
      } catch {
        /* ignore */
      }
    }
  }
  inflight = null;
  host = null;
  seq = 0;
}

function settleReject(error: Error): void {
  if (!inflight || inflight.settled) return;
  const entry = inflight;
  markSettled(entry);
  clearHostRequest();
  entry.reject(error);
}

function markSettled(entry: Inflight): void {
  entry.settled = true;
  clearTimeout(entry.timer);
  if (entry.signal && entry.onAbort) {
    try {
      entry.signal.removeEventListener("abort", entry.onAbort);
    } catch {
      /* ignore */
    }
  }
  if (inflight === entry) {
    inflight = null;
  }
}

function clearHostRequest(): void {
  try {
    host?.setRequest(null);
  } catch {
    /* ignore host teardown errors */
  }
}

function normalizeResult(result: PdfExtractionResult): PdfExtractionResult {
  const docs = Array.isArray(result?.docs) ? result.docs : [];
  const skippedPages = Array.isArray(result?.skippedPages)
    ? result.skippedPages
    : [];
  const docCount = result?.documentPageCount;
  return {
    docs: docs.map((d) => ({
      docId: typeof d?.docId === "string" ? d.docId : "",
      title: d?.title,
      text: typeof d?.text === "string" ? d.text : "",
    })),
    skippedPages: skippedPages.filter(
      (p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1,
    ),
    ...(typeof docCount === "number" &&
    Number.isInteger(docCount) &&
    docCount >= 1
      ? { documentPageCount: docCount }
      : {}),
  };
}
