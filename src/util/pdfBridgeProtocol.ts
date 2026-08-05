/**
 * Pure WebView bridge protocol for PDF text + image extraction.
 *
 * Zero RN imports — validates untrusted postMessage payloads, accumulates
 * chunked page data, and enforces hard caps so a hostile PDF cannot grow RN
 * memory without bound or hold the bridge open via incomplete pages (the
 * component owns wall-clock timeouts; this module reports completion state).
 *
 * X1: page-scoped `{ page, done: true }` must never be treated as global
 * `{ done: true }` completion. Parser and feed path preserve that distinction.
 *
 * Cap vs malformed: parse failures are categorized so the component can
 * fail-closed on caps (never silently drop a page) while ignoring hostile junk.
 *
 * Image-mode messages keep the original field shapes (no `kind`) so the
 * existing JPEG path stays compatible. Text-mode messages use a `kind` field.
 *
 * MAX_TOTAL_TEXT_BYTES / payload lengths count UTF-16 code units (JS string
 * `.length`), not UTF-8 bytes — CJK and non-BMP characters cost 1–2 units
 * per character and can double relative to a naive byte budget.
 */

import type { PdfTextItem } from "./pdfText";

// ── Caps (hostile-PDF / phone-memory bounds) ───────────────────────────────

/** Match existing PdfToImages default — vision token budget + phone RAM. */
export const MAX_PDF_PAGES = 5;

/**
 * pdf.js can emit huge item arrays for crafted PDFs. Cap before RN holds them.
 * Real multi-column papers are typically thousands, not tens of thousands.
 */
export const MAX_ITEMS_PER_PAGE = 20_000;

/**
 * Max UTF-16 code units per projected `str`. Enforced in the WebView before
 * JSON.stringify (too late on RN alone — payload would already be huge).
 */
export const MAX_ITEM_STR_CHARS = 50_000;

/**
 * Total assembled text-item JSON payload across all pages, measured in UTF-16
 * code units (JS string length — not UTF-8 bytes; CJK costs more). Keeps
 * Hermes heap from ballooning on a text-stuffed document.
 */
export const MAX_TOTAL_TEXT_BYTES = 1_500_000;

/**
 * Per-page assembled payload (text JSON or image base64), UTF-16 code units.
 *
 * Sized for a legitimate tall-page JPEG: scale min(1.5, 1024/w) at q0.8 can
 * produce multi-MB base64 (e.g. ~1024×8000 → ~2–4 MB). Pre-phase-B had no
 * chunk-count cap and delivered these; the payload floor must keep doing so.
 */
export const MAX_PAGE_PAYLOAD_BYTES = 5_000_000;

/** Matches the existing WebView chunk size (200 KB of string payload). */
export const CHUNK_SIZE = 200_000;

/**
 * Max chunks per page, derived from the payload cap so the two cannot disagree:
 *   ceil(MAX_PAGE_PAYLOAD_BYTES / CHUNK_SIZE) + 1 headroom
 * Invariant (harness-pinned):
 *   MAX_CHUNKS_PER_PAGE * CHUNK_SIZE >= MAX_PAGE_PAYLOAD_BYTES
 */
export function maxChunksForPayload(
  payloadBytes: number,
  chunkSize: number = CHUNK_SIZE,
): number {
  const size = chunkSize > 0 ? chunkSize : CHUNK_SIZE;
  const payload = payloadBytes > 0 ? payloadBytes : 0;
  return Math.ceil(payload / size) + 1;
}

export const MAX_CHUNKS_PER_PAGE = maxChunksForPayload(
  MAX_PAGE_PAYLOAD_BYTES,
  CHUNK_SIZE,
);

/** Existing per-page wall-clock budget — reused by the component. */
export const PAGE_TIMEOUT_MS = 30_000;

/**
 * Whole-document budget: text pass for up to MAX_PDF_PAGES plus optional JPEG
 * fallback for text-less pages (same per-page timeout headroom).
 */
export const TOTAL_EXTRACTION_TIMEOUT_MS = 150_000;

// ── Message types ──────────────────────────────────────────────────────────

/** Projected pdf.js text item fields only (bridge must not ship fontName/dir/…). */
export type ProjectedTextItem = PdfTextItem;

/** Image base64 chunk — original shape (no `kind`) for image-only mode. */
export type ImageChunkMessage = {
  page: number;
  chunk: number;
  total: number;
  data: string;
};

/** Per-page image completion — original shape. */
export type ImagePageDoneMessage = {
  page: number;
  done: true;
};

/** Global completion — original shape (no `page` key). */
export type GlobalDoneMessage = {
  done: true;
};

/** Error from the WebView — original shape. */
export type ErrorMessage = {
  error: string;
};

/** Chunk of JSON-stringified projected text items for one page. */
export type TextChunkMessage = {
  kind: "textChunk";
  page: number;
  chunk: number;
  total: number;
  data: string;
};

/**
 * Text extraction finished for one page (instrumentation from inside WebView).
 * Optional: page may complete from chunks alone; meta may arrive before/after.
 */
export type TextPageDoneMessage = {
  kind: "textPageDone";
  page: number;
  getTextContentMs: number;
  itemCount: number;
  projectedBytes: number;
};

/**
 * All pages' text pass finished. `pageCount` is how many pages the WebView
 * processed so RN can reconcile missing pages (never silently shrink the set).
 */
export type TextPassDoneMessage = {
  kind: "textPassDone";
  pageCount: number;
};

export type BridgeMessage =
  | ImageChunkMessage
  | ImagePageDoneMessage
  | GlobalDoneMessage
  | ErrorMessage
  | TextChunkMessage
  | TextPageDoneMessage
  | TextPassDoneMessage;

// ── Parse result ───────────────────────────────────────────────────────────

/**
 * `cap` — budget/limit exceeded; the component must fail-closed (never ignore).
 * `malformed` — hostile/garbage JSON; safe to ignore without throwing.
 */
export type ParseOk = { ok: true; message: BridgeMessage };
export type ParseFail = {
  ok: false;
  category: "malformed" | "cap";
  reason: string;
};
export type ParseResult = ParseOk | ParseFail;

function isFiniteInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n);
}

function isNonNegInt(n: unknown): n is number {
  return isFiniteInt(n) && n >= 0;
}

function isPosInt(n: unknown): n is number {
  return isFiniteInt(n) && n >= 1;
}

function malformed(reason: string): ParseFail {
  return { ok: false, category: "malformed", reason };
}

function cap(reason: string): ParseFail {
  return { ok: false, category: "cap", reason };
}

/**
 * Validate chunk fields shared by image and text chunk messages.
 * Distinguishes cap (over budget) from malformed (wrong types / impossible).
 */
function parseChunkFields(
  m: Record<string, unknown>,
  maxPages: number,
  maxChunks: number,
):
  | { ok: true; page: number; chunk: number; total: number; data: string }
  | ParseFail {
  if (!isPosInt(m.page)) {
    return malformed("bad_page");
  }
  if (m.page > maxPages) {
    return cap("page_cap");
  }
  if (!isNonNegInt(m.chunk)) {
    return malformed("bad_chunk_index");
  }
  if (m.chunk >= maxChunks) {
    return cap("chunk_index_cap");
  }
  if (!isPosInt(m.total)) {
    return malformed("bad_chunk_total");
  }
  if (m.total > maxChunks) {
    return cap("chunk_total_cap");
  }
  if (m.chunk >= m.total) {
    return malformed("chunk_out_of_range");
  }
  if (typeof m.data !== "string") {
    return malformed("bad_data");
  }
  // Allow a small slack over CHUNK_SIZE for encoding edge cases; hard over is a cap.
  if (m.data.length > CHUNK_SIZE + 1024) {
    return cap("chunk_too_large");
  }
  return {
    ok: true,
    page: m.page,
    chunk: m.chunk,
    total: m.total,
    data: m.data,
  };
}

/**
 * Validate an untrusted WebView postMessage string.
 * Never throws. Cap exceeded → category "cap"; garbage → category "malformed".
 */
export function parseBridgeMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return malformed("non_string");
  }
  // Bound parse cost: a multi-MB single message is a cap, not "ignore".
  if (raw.length > MAX_PAGE_PAYLOAD_BYTES + 4096) {
    return cap("message_too_large");
  }

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return malformed("invalid_json");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return malformed("not_object");
  }

  const m = obj as Record<string, unknown>;

  // Text-mode messages (discriminated by kind) — check before bare shapes.
  if (m.kind === "textChunk") {
    const fields = parseChunkFields(m, MAX_PDF_PAGES, MAX_CHUNKS_PER_PAGE);
    if (!fields.ok) return fields;
    return {
      ok: true,
      message: {
        kind: "textChunk",
        page: fields.page,
        chunk: fields.chunk,
        total: fields.total,
        data: fields.data,
      },
    };
  }

  if (m.kind === "textPageDone") {
    if (!isPosInt(m.page)) {
      return malformed("bad_page");
    }
    if (m.page > MAX_PDF_PAGES) {
      return cap("page_cap");
    }
    const getTextContentMs =
      typeof m.getTextContentMs === "number" &&
      Number.isFinite(m.getTextContentMs) &&
      m.getTextContentMs >= 0
        ? m.getTextContentMs
        : 0;
    // Clamp oversized itemCount rather than fail — meta is advisory.
    let itemCount = 0;
    if (isNonNegInt(m.itemCount)) {
      itemCount =
        m.itemCount > MAX_ITEMS_PER_PAGE ? MAX_ITEMS_PER_PAGE : m.itemCount;
    }
    let projectedBytes = 0;
    if (isNonNegInt(m.projectedBytes)) {
      projectedBytes =
        m.projectedBytes > MAX_PAGE_PAYLOAD_BYTES
          ? MAX_PAGE_PAYLOAD_BYTES
          : m.projectedBytes;
    }
    return {
      ok: true,
      message: {
        kind: "textPageDone",
        page: m.page,
        getTextContentMs,
        itemCount,
        projectedBytes,
      },
    };
  }

  if (m.kind === "textPassDone") {
    if (m.pageCount === undefined) {
      // Missing pageCount is malformed for phase-B wire format; treat as 0
      // so reconcile can still run without throwing.
      return { ok: true, message: { kind: "textPassDone", pageCount: 0 } };
    }
    if (!isNonNegInt(m.pageCount)) {
      return malformed("bad_page_count");
    }
    if (m.pageCount > MAX_PDF_PAGES) {
      return cap("page_cap");
    }
    return { ok: true, message: { kind: "textPassDone", pageCount: m.pageCount } };
  }

  // Error (original shape)
  if ("error" in m) {
    if (typeof m.error !== "string" || m.error.length === 0) {
      return malformed("bad_error");
    }
    const err = m.error.length > 500 ? m.error.slice(0, 500) : m.error;
    return { ok: true, message: { error: err } };
  }

  // X1: page-scoped messages must be classified before bare { done: true }.
  if ("page" in m) {
    if (!isPosInt(m.page)) {
      return malformed("bad_page");
    }
    if (m.page > MAX_PDF_PAGES) {
      return cap("page_cap");
    }

    // Per-page done: { page, done: true } — NOT global completion.
    if (m.done === true) {
      if ("chunk" in m || "data" in m || "total" in m) {
        return malformed("ambiguous_page_done");
      }
      return {
        ok: true,
        message: { page: m.page, done: true },
      };
    }

    // Image chunk: { page, chunk, total, data }
    const fields = parseChunkFields(m, MAX_PDF_PAGES, MAX_CHUNKS_PER_PAGE);
    if (!fields.ok) return fields;
    return {
      ok: true,
      message: {
        page: fields.page,
        chunk: fields.chunk,
        total: fields.total,
        data: fields.data,
      },
    };
  }

  // Global done only when there is no `page` key (X1).
  if (m.done === true) {
    return { ok: true, message: { done: true } };
  }

  return malformed("unknown_shape");
}

// ── Accumulator ────────────────────────────────────────────────────────────

export type TextPageMeta = {
  getTextContentMs: number;
  itemCount: number;
  projectedBytes: number;
};

export type AccumulatorEvent =
  | { type: "image_page"; page: number; base64: string }
  | { type: "text_page"; page: number; items: ProjectedTextItem[]; meta: TextPageMeta }
  | { type: "text_pass_done"; pageCount: number }
  | { type: "global_done" }
  | { type: "error"; error: string }
  | { type: "cap_exceeded"; reason: string }
  | { type: "noop" };

type ChunkBucket = {
  total: number | null;
  /** Sparse by chunk index; first-write-wins for duplicates. */
  parts: (string | undefined)[];
  received: number;
  bytes: number;
  completed: boolean;
};

function emptyBucket(): ChunkBucket {
  return {
    total: null,
    parts: [],
    received: 0,
    bytes: 0,
    completed: false,
  };
}

function bucketComplete(b: ChunkBucket): boolean {
  if (b.completed) return true;
  if (b.total === null || b.total < 1) return false;
  if (b.received !== b.total) return false;
  for (let i = 0; i < b.total; i++) {
    if (typeof b.parts[i] !== "string") return false;
  }
  return true;
}

function joinBucket(b: ChunkBucket): string {
  const n = b.total ?? 0;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(b.parts[i] ?? "");
  }
  return parts.join("");
}

/**
 * Project / sanitize a single text item from untrusted JSON.
 * Never throws. Drops unknown fields. Caps str length.
 */
export function projectTextItem(raw: unknown): ProjectedTextItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.str !== "string") return null;
  const str =
    o.str.length > MAX_ITEM_STR_CHARS
      ? o.str.slice(0, MAX_ITEM_STR_CHARS)
      : o.str;
  const item: ProjectedTextItem = { str };
  if (o.hasEOL === true) item.hasEOL = true;
  if (typeof o.width === "number" && Number.isFinite(o.width)) {
    item.width = o.width;
  }
  if (Array.isArray(o.transform) && o.transform.length >= 6) {
    const t: number[] = [];
    for (let i = 0; i < 6; i++) {
      const v = o.transform[i];
      t.push(typeof v === "number" && Number.isFinite(v) ? v : 0);
    }
    item.transform = t;
  }
  return item;
}

/**
 * Parse joined text-chunk JSON into projected items. Never throws.
 * Returns null if the payload is not a usable array.
 */
export function parseTextItemsJson(json: string): ProjectedTextItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const items: ProjectedTextItem[] = [];
  const limit = Math.min(parsed.length, MAX_ITEMS_PER_PAGE);
  for (let i = 0; i < limit; i++) {
    const it = projectTextItem(parsed[i]);
    if (it) items.push(it);
  }
  return items;
}

/**
 * Reconcile WebView-reported page count with pages the accumulator completed.
 * Missing pages must never be silently omitted from docs / fallback.
 */
export function reconcileTextPassPages(
  completedPageNumbers: number[],
  reportedPageCount: number,
): { expected: number[]; missing: number[] } {
  const n =
    typeof reportedPageCount === "number" &&
    Number.isFinite(reportedPageCount) &&
    reportedPageCount > 0
      ? Math.min(Math.floor(reportedPageCount), MAX_PDF_PAGES)
      : 0;
  const expected: number[] = [];
  for (let p = 1; p <= n; p++) expected.push(p);
  const have = new Set(
    completedPageNumbers.filter(
      (p) => typeof p === "number" && Number.isInteger(p) && p >= 1,
    ),
  );
  const missing = expected.filter((p) => !have.has(p));
  return { expected, missing };
}

/**
 * Stable retrieval source id from a local URI — never the full filesystem path.
 * Callers may still pass an explicit sourceId.
 */
export function sanitizePdfSourceId(
  pdfUri: string,
  explicit?: string | null,
): string {
  if (typeof explicit === "string" && explicit.length > 0) {
    // Still strip path separators from explicit ids to avoid path-like docIds.
    const cleaned = explicit.replace(/[/\\]+/g, "_").slice(0, 120);
    return cleaned.length > 0 ? cleaned : "pdf";
  }
  if (typeof pdfUri !== "string" || pdfUri.length === 0) return "pdf";
  const normalized = pdfUri.replace(/\\/g, "/");
  const base = normalized.split("/").pop() || "pdf";
  const noQuery = base.split("?")[0] || "pdf";
  const safe = noQuery.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return safe.length > 0 ? safe : "pdf";
}

/** Floor maxPages: 0/NaN/negative → default; otherwise clamp to [1, MAX_PDF_PAGES]. */
export function clampMaxPages(
  maxPages: unknown,
  fallback: number = MAX_PDF_PAGES,
): number {
  const fb =
    typeof fallback === "number" && fallback >= 1
      ? Math.min(Math.floor(fallback), MAX_PDF_PAGES)
      : MAX_PDF_PAGES;
  if (typeof maxPages !== "number" || !Number.isFinite(maxPages)) return fb;
  const n = Math.floor(maxPages);
  if (n < 1) return fb;
  return Math.min(n, MAX_PDF_PAGES);
}

export type AccumulatorOptions = {
  maxPages?: number;
  maxItemsPerPage?: number;
  maxTotalTextBytes?: number;
  maxPagePayloadBytes?: number;
  maxChunksPerPage?: number;
};

/**
 * Feed validated bridge messages; emit completed pages / pass / global done.
 * Deterministic: same message sequence → same events (first-write-wins on
 * duplicate chunk indices).
 */
export class PdfBridgeAccumulator {
  private readonly maxPages: number;
  private readonly maxItemsPerPage: number;
  private readonly maxTotalTextBytes: number;
  private readonly maxPagePayloadBytes: number;
  private readonly maxChunksPerPage: number;

  private imageBuckets: Map<number, ChunkBucket> = new Map();
  private textBuckets: Map<number, ChunkBucket> = new Map();
  private textMeta: Map<number, TextPageMeta> = new Map();
  private textCompletedPages: Set<number> = new Set();
  private imageCompletedPages: Set<number> = new Set();
  private totalTextBytes = 0;
  private closed = false;
  private textPassDone = false;
  private globalDone = false;
  private reportedTextPageCount = 0;

  constructor(opts: AccumulatorOptions = {}) {
    this.maxPages = opts.maxPages ?? MAX_PDF_PAGES;
    this.maxItemsPerPage = opts.maxItemsPerPage ?? MAX_ITEMS_PER_PAGE;
    this.maxTotalTextBytes = opts.maxTotalTextBytes ?? MAX_TOTAL_TEXT_BYTES;
    this.maxPagePayloadBytes =
      opts.maxPagePayloadBytes ?? MAX_PAGE_PAYLOAD_BYTES;
    this.maxChunksPerPage = opts.maxChunksPerPage ?? MAX_CHUNKS_PER_PAGE;
  }

  isTextPageComplete(page: number): boolean {
    return this.textCompletedPages.has(page);
  }

  isImagePageComplete(page: number): boolean {
    return this.imageCompletedPages.has(page);
  }

  /**
   * True when every expected chunk slot is filled (even if not yet emitted).
   * Missing chunks → false (page never completes; component times out).
   */
  isTextPageReady(page: number): boolean {
    const b = this.textBuckets.get(page);
    return !!b && bucketComplete(b);
  }

  hasGlobalDone(): boolean {
    return this.globalDone;
  }

  getTotalTextBytes(): number {
    return this.totalTextBytes;
  }

  getCompletedTextPages(): number[] {
    return Array.from(this.textCompletedPages).sort((a, b) => a - b);
  }

  getReportedTextPageCount(): number {
    return this.reportedTextPageCount;
  }

  reset(): void {
    this.imageBuckets = new Map();
    this.textBuckets = new Map();
    this.textMeta = new Map();
    this.textCompletedPages = new Set();
    this.imageCompletedPages = new Set();
    this.totalTextBytes = 0;
    this.closed = false;
    this.textPassDone = false;
    this.globalDone = false;
    this.reportedTextPageCount = 0;
  }

  feed(message: BridgeMessage): AccumulatorEvent {
    if (this.closed) return { type: "noop" };

    if ("error" in message && typeof (message as ErrorMessage).error === "string") {
      this.closed = true;
      return { type: "error", error: (message as ErrorMessage).error };
    }

    if ("kind" in message) {
      if (message.kind === "textChunk") {
        return this.feedTextChunk(message);
      }
      if (message.kind === "textPageDone") {
        this.textMeta.set(message.page, {
          getTextContentMs: message.getTextContentMs,
          itemCount: message.itemCount,
          projectedBytes: message.projectedBytes,
        });
        if (
          this.isTextPageReady(message.page) &&
          !this.textCompletedPages.has(message.page)
        ) {
          return this.emitTextPage(message.page);
        }
        return { type: "noop" };
      }
      if (message.kind === "textPassDone") {
        if (this.textPassDone) return { type: "noop" };
        this.textPassDone = true;
        this.reportedTextPageCount = message.pageCount;
        return { type: "text_pass_done", pageCount: message.pageCount };
      }
    }

    // X1: page key first
    if ("page" in message) {
      if ("done" in message && (message as ImagePageDoneMessage).done === true) {
        return { type: "noop" };
      }
      return this.feedImageChunk(message as ImageChunkMessage);
    }

    if ("done" in message && (message as GlobalDoneMessage).done === true) {
      if (this.globalDone) return { type: "noop" };
      this.globalDone = true;
      // Do NOT close the accumulator here — in-flight image writes may still
      // need to complete on the component side. Further messages after done
      // are ignored via globalDone / component doneRef.
      return { type: "global_done" };
    }

    return { type: "noop" };
  }

  private feedTextChunk(message: TextChunkMessage): AccumulatorEvent {
    const page = message.page;
    if (page < 1 || page > this.maxPages) {
      return { type: "cap_exceeded", reason: "page_out_of_range" };
    }
    if (this.textCompletedPages.has(page)) {
      return { type: "noop" };
    }

    let b = this.textBuckets.get(page);
    if (!b) {
      b = emptyBucket();
      this.textBuckets.set(page, b);
    }
    if (b.completed) return { type: "noop" };

    if (message.total > this.maxChunksPerPage) {
      return { type: "cap_exceeded", reason: "chunk_total_cap" };
    }
    if (b.total !== null && b.total !== message.total) {
      return { type: "cap_exceeded", reason: "chunk_total_mismatch" };
    }
    b.total = message.total;

    // First-write-wins: duplicate index is ignored (deterministic).
    if (typeof b.parts[message.chunk] === "string") {
      return { type: "noop" };
    }

    const nextBytes = b.bytes + message.data.length;
    if (nextBytes > this.maxPagePayloadBytes) {
      return { type: "cap_exceeded", reason: "page_payload_cap" };
    }
    if (this.totalTextBytes + message.data.length > this.maxTotalTextBytes) {
      return { type: "cap_exceeded", reason: "total_text_bytes_cap" };
    }

    b.parts[message.chunk] = message.data;
    b.received += 1;
    b.bytes = nextBytes;
    this.totalTextBytes += message.data.length;

    if (!bucketComplete(b)) {
      return { type: "noop" };
    }
    return this.emitTextPage(page);
  }

  private emitTextPage(page: number): AccumulatorEvent {
    const b = this.textBuckets.get(page);
    if (!b || !bucketComplete(b) || this.textCompletedPages.has(page)) {
      return { type: "noop" };
    }
    b.completed = true;
    const joined = joinBucket(b);
    b.parts = [];

    const parsed = parseTextItemsJson(joined);
    let items: ProjectedTextItem[] = parsed ?? [];
    if (items.length > this.maxItemsPerPage) {
      items = items.slice(0, this.maxItemsPerPage);
    }

    this.textCompletedPages.add(page);
    const meta = this.textMeta.get(page) ?? {
      getTextContentMs: 0,
      itemCount: items.length,
      projectedBytes: joined.length,
    };
    return { type: "text_page", page, items, meta };
  }

  private feedImageChunk(message: ImageChunkMessage): AccumulatorEvent {
    const page = message.page;
    if (page < 1 || page > this.maxPages) {
      return { type: "cap_exceeded", reason: "page_out_of_range" };
    }
    if (this.imageCompletedPages.has(page)) {
      return { type: "noop" };
    }

    let b = this.imageBuckets.get(page);
    if (!b) {
      b = emptyBucket();
      this.imageBuckets.set(page, b);
    }
    if (b.completed) return { type: "noop" };

    if (message.total > this.maxChunksPerPage) {
      return { type: "cap_exceeded", reason: "chunk_total_cap" };
    }
    if (b.total !== null && b.total !== message.total) {
      return { type: "cap_exceeded", reason: "chunk_total_mismatch" };
    }
    b.total = message.total;

    if (typeof b.parts[message.chunk] === "string") {
      return { type: "noop" };
    }

    const nextBytes = b.bytes + message.data.length;
    if (nextBytes > this.maxPagePayloadBytes) {
      return { type: "cap_exceeded", reason: "page_payload_cap" };
    }

    b.parts[message.chunk] = message.data;
    b.received += 1;
    b.bytes = nextBytes;

    if (!bucketComplete(b)) {
      return { type: "noop" };
    }

    b.completed = true;
    const base64 = joinBucket(b);
    b.parts = [];
    this.imageCompletedPages.add(page);
    return { type: "image_page", page, base64 };
  }
}

/**
 * Split a string into bridge-sized chunks (for harness / tests).
 * Empty string → one empty chunk so total ≥ 1 (matches WebView send path).
 */
export function splitIntoChunks(
  data: string,
  chunkSize: number = CHUNK_SIZE,
): string[] {
  const size = chunkSize > 0 ? chunkSize : CHUNK_SIZE;
  if (data.length === 0) return [""];
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size));
  }
  return out;
}

/**
 * Build a deterministic sequence of textChunk messages for a page's items.
 */
export function buildTextChunkMessages(
  page: number,
  items: ProjectedTextItem[],
  chunkSize: number = CHUNK_SIZE,
): TextChunkMessage[] {
  const json = JSON.stringify(items);
  const parts = splitIntoChunks(json, chunkSize);
  return parts.map((data, chunk) => ({
    kind: "textChunk" as const,
    page,
    chunk,
    total: parts.length,
    data,
  }));
}

/**
 * Build image chunk messages for a base64 payload (harness / F1 regression).
 */
export function buildImageChunkMessages(
  page: number,
  base64: string,
  chunkSize: number = CHUNK_SIZE,
): ImageChunkMessage[] {
  const parts = splitIntoChunks(base64, chunkSize);
  return parts.map((data, chunk) => ({
    page,
    chunk,
    total: parts.length,
    data,
  }));
}
