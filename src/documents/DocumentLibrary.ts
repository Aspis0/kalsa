/**
 * Document library — pure state model + strategy helpers for local PDF/TXT chat.
 *
 * No React Native imports at module scope (Node harness must stay clean).
 * Persistence uses an injected AsyncStorage-like `{ getItem, setItem }`;
 * the default wrapper lazy-requires `@react-native-async-storage/async-storage`
 * only when called (same pattern as deviceProfile's dynamic require).
 */

export type LibraryDocKind = "pdf" | "txt";

/**
 * Outcome of the import-time text extraction for a library entry.
 * - "ok": extraction succeeded (docCount may still be 0 if the file is empty).
 * - "no_text_layer": extraction ran but no searchable text (scanned PDF) → vision_fallback.
 * - "timeout" | "renderer_error" | "fs_error": extraction failed → surface error, NOT vision.
 * Absent on legacy entries: treat like "ok" when docCount > 0, else "no_text_layer"
 * (preserves prior vision_fallback behaviour for unscanned imports).
 */
export type ExtractionStatus =
  | "ok"
  | "no_text_layer"
  | "timeout"
  | "renderer_error"
  | "fs_error";

export type LibraryDoc = {
  id: string;
  name: string;
  /** Base id used for retrieval docs (`sourceId#pN` for PDF pages). */
  sourceId: string;
  kind: LibraryDocKind;
  /** Epoch ms when the doc was added. */
  addedAt: number;
  /** Extracted PDF page count (capped at MAX_PDF_PAGES); omitted for TXT. */
  pageCount?: number;
  sizeBytes: number;
  /**
   * Number of text-layer retrieval docs available after extraction.
   * 0 + extractionStatus "no_text_layer"|"ok" → vision_fallback.
   * 0 + extractionStatus timeout/error → surface error, not vision.
   */
  docCount: number;
  /**
   * Local file URI the host can re-open for extraction / TXT read.
   * Persisted so library entries survive restarts.
   */
  fileUri: string;
  /**
   * Optional precomputed token estimate (whitespace/4). When absent the tool
   * re-estimates from extracted text on demand.
   */
  estimatedTokens?: number;
  /**
   * Import-time extraction outcome. Distinguishes scanned PDFs (vision ok)
   * from timeout/renderer/fs failures (must NOT route to vision_fallback).
   */
  extractionStatus?: ExtractionStatus;
  /**
   * Durable page-1 cover JPEG under documentDirectory/kalsa-covers/.
   * Optional; missing on legacy entries and TXT/MD. Never points at cacheDirectory.
   */
  previewUri?: string;
};

/** True when import-time extraction failed and re-embedding cannot succeed. */
export function isDocumentUnreadable(
  doc: Pick<LibraryDoc, "docCount" | "extractionStatus">,
): boolean {
  if (doc.docCount > 0) return false;
  return (
    doc.extractionStatus === "timeout" ||
    doc.extractionStatus === "renderer_error" ||
    doc.extractionStatus === "fs_error"
  );
}

export type LibraryState = {
  docs: LibraryDoc[];
};

export type DocStrategy = "full_context" | "retrieve" | "vision_fallback";

export type DecideDocStrategyInput = {
  docCount: number;
  estimatedTokens: number | null;
  ctxTokens: number;
};

/** AsyncStorage key for the library document list. */
export const DOCUMENT_LIBRARY_STORAGE_KEY = "kalsa.documents.library";

/** Structural match for AsyncStorage (injected in tests / production). */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
};

/** Empty library. */
export function emptyLibraryState(): LibraryState {
  return { docs: [] };
}

/**
 * Pure add — replaces an existing entry with the same id, otherwise prepends
 * (new-on-top). Does not mutate `state`.
 */
export function addDoc(state: LibraryState, doc: LibraryDoc): LibraryState {
  const docs = Array.isArray(state?.docs) ? state.docs : [];
  if (!doc || typeof doc.id !== "string" || doc.id.length === 0) {
    return { docs: docs.slice() };
  }
  const next = docs.filter((d) => d.id !== doc.id);
  next.unshift(sanitizeDoc(doc));
  return { docs: next };
}

/**
 * Pure reorder. `orderedIds` must be an exact permutation of current doc ids
 * (same length, same elements, no duplicates). Malformed input returns the
 * unchanged state — never drops or duplicates a document. Does not mutate
 * `state` and never rewrites `addedAt`.
 */
export function reorderDocs(
  state: LibraryState,
  orderedIds: string[],
): LibraryState {
  const docs = Array.isArray(state?.docs) ? state.docs : [];
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { docs: docs.slice() };
  }
  if (orderedIds.length !== docs.length) {
    return { docs: docs.slice() };
  }
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (typeof id !== "string" || id.length === 0) {
      return { docs: docs.slice() };
    }
    if (seen.has(id)) {
      return { docs: docs.slice() };
    }
    seen.add(id);
  }
  const byId = new Map<string, LibraryDoc>();
  for (const d of docs) {
    byId.set(d.id, d);
  }
  if (byId.size !== docs.length) {
    // Defensive: duplicate ids already in state — refuse reorder.
    return { docs: docs.slice() };
  }
  const next: LibraryDoc[] = [];
  for (const id of orderedIds) {
    const d = byId.get(id);
    if (!d) {
      return { docs: docs.slice() };
    }
    next.push(d);
  }
  return { docs: next };
}

/**
 * Cap plain text at 200 Unicode code points for list/detail previews.
 * Trims, strips NULs, cuts on a code-point boundary. Empty / whitespace-only
 * → undefined (caller shows placeholder).
 */
export function makePreviewSnippet(plainText: string): string | undefined {
  if (typeof plainText !== "string") return undefined;
  // Strip NULs so binary leakage never reaches UI copy.
  const cleaned = plainText.replace(/\u0000/g, "");
  const trimmed = cleaned.trim();
  if (!trimmed) return undefined;
  const chars = Array.from(trimmed);
  if (chars.length <= 200) return chars.join("");
  return chars.slice(0, 200).join("");
}

/**
 * Locale-aware byte size for list/detail meta (Italian "1,4 MB", English "1.4 MB").
 * Uses decimal (1000) units to match user-facing storage labels.
 */
export function formatBytesLocalized(
  bytes: number,
  locale: string = "en",
): string {
  const n =
    typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0
      ? bytes
      : 0;
  const loc = locale && locale.toLowerCase().startsWith("it") ? "it-IT" : "en-US";
  const fmt = (value: number, fractionDigits: number) =>
    new Intl.NumberFormat(loc, {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  if (n < 1000) return `${fmt(Math.floor(n), 0)} B`;
  if (n < 1_000_000) {
    const kb = n / 1000;
    return `${fmt(kb, kb < 10 ? 1 : 0)} KB`;
  }
  if (n < 1_000_000_000) {
    const mb = n / 1_000_000;
    return `${fmt(mb, mb < 10 ? 1 : 0)} MB`;
  }
  const gb = n / 1_000_000_000;
  return `${fmt(gb, gb < 10 ? 1 : 0)} GB`;
}

/**
 * Calendar-date bucket for "Added today / yesterday / {date}" labels.
 * Uses local timezone midnight boundaries (not elapsed 24h).
 */
export function formatAddedBucket(
  addedAt: number,
  nowMs: number = Date.now(),
): "today" | "yesterday" | "older" {
  const added =
    typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : nowMs;
  const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  const startOfLocalDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today0 = startOfLocalDay(now);
  const added0 = startOfLocalDay(added);
  const dayMs = 24 * 60 * 60 * 1000;
  if (added0 === today0) return "today";
  if (added0 === today0 - dayMs) return "yesterday";
  return "older";
}

/** Format an absolute short date for the "Added {date}" fallback. */
export function formatAddedDate(
  addedAt: number,
  locale: string = "en",
): string {
  const ms =
    typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : Date.now();
  const loc = locale && locale.toLowerCase().startsWith("it") ? "it-IT" : "en-US";
  try {
    return new Intl.DateTimeFormat(loc, {
      day: "numeric",
      month: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

/**
 * Pure remove by id. Missing id is a no-op.
 * Does not mutate `state`.
 */
export function removeDoc(state: LibraryState, id: string): LibraryState {
  const docs = Array.isArray(state?.docs) ? state.docs : [];
  if (typeof id !== "string" || id.length === 0) {
    return { docs: docs.slice() };
  }
  return { docs: docs.filter((d) => d.id !== id) };
}

/**
 * Stable key for a library entry (used by index maps / host caches).
 * Returns null when the id is not in the library.
 */
export function docKey(state: LibraryState, id: string): string | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const docs = Array.isArray(state?.docs) ? state.docs : [];
  const found = docs.find((d) => d.id === id);
  return found ? found.id : null;
}

/**
 * True when a library entry with no text layer should route to vision fallback.
 * FIX 5: only "no_text_layer" / "ok"+empty (or legacy absent status) may vision;
 * timeout / renderer_error / fs_error must surface an error + retry instead.
 */
export function shouldUseVisionFallback(doc: {
  docCount?: number;
  extractionStatus?: ExtractionStatus;
}): boolean {
  const count =
    typeof doc?.docCount === "number" && Number.isFinite(doc.docCount)
      ? Math.max(0, Math.floor(doc.docCount))
      : 0;
  if (count > 0) return false;
  const status = doc?.extractionStatus;
  if (status === "timeout" || status === "renderer_error" || status === "fs_error") {
    return false;
  }
  // "ok" with empty text, explicit "no_text_layer", or legacy missing status.
  return true;
}

/**
 * Hybrid routing for a single document query:
 * - no text layer (docCount 0) → vision_fallback
 * - small docs (estimatedTokens < 0.5 × ctxTokens) → full_context
 * - otherwise → retrieve
 *
 * When estimatedTokens is null, treat as large (retrieve) if text exists —
 * never invent a full-context path without a size signal.
 *
 * Callers that know extractionStatus must gate vision via shouldUseVisionFallback
 * BEFORE calling this (or pass a positive docCount for non-vision error paths).
 */
export function decideDocStrategy(input: DecideDocStrategyInput): DocStrategy {
  const docCount =
    typeof input?.docCount === "number" && Number.isFinite(input.docCount)
      ? Math.max(0, Math.floor(input.docCount))
      : 0;
  if (docCount <= 0) return "vision_fallback";

  const ctx =
    typeof input?.ctxTokens === "number" &&
    Number.isFinite(input.ctxTokens) &&
    input.ctxTokens > 0
      ? input.ctxTokens
      : 0;
  const est = input?.estimatedTokens;
  if (
    typeof est === "number" &&
    Number.isFinite(est) &&
    est >= 0 &&
    ctx > 0 &&
    est < 0.5 * ctx
  ) {
    return "full_context";
  }
  return "retrieve";
}

/**
 * Token estimate: character length / 4 (documented approximation).
 * Pure, no tokenizer dependency. Empty / non-string → 0.
 */
export function estimateTokensForDoc(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Citation label from a retrieval docId.
 * `"sourceId#pN"` → `"p. N"`; unknown shape → empty string.
 */
export function formatPassageCitation(docId: string): string {
  if (typeof docId !== "string") return "";
  const m = /#p(\d+)$/.exec(docId);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return "";
  return `p. ${n}`;
}

/** Serialize library state for storage. */
export function serializeLibraryState(state: LibraryState): string {
  const docs = Array.isArray(state?.docs) ? state.docs.map(sanitizeDoc) : [];
  return JSON.stringify({ docs });
}

/** Parse library state; corrupt / missing → empty. */
export function parseLibraryState(raw: string | null | undefined): LibraryState {
  if (!raw || typeof raw !== "string") return emptyLibraryState();
  try {
    const obj = JSON.parse(raw) as { docs?: unknown };
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.docs)) {
      return emptyLibraryState();
    }
    const docs: LibraryDoc[] = [];
    for (const item of obj.docs) {
      const d = tryParseDoc(item);
      if (d) docs.push(d);
    }
    return { docs };
  } catch {
    return emptyLibraryState();
  }
}

/** Load library via injected storage. */
export async function loadLibraryState(
  storage: KeyValueStorage,
  key: string = DOCUMENT_LIBRARY_STORAGE_KEY,
): Promise<LibraryState> {
  try {
    const raw = await storage.getItem(key);
    return parseLibraryState(raw);
  } catch {
    return emptyLibraryState();
  }
}

/** Persist library via injected storage. */
export async function saveLibraryState(
  storage: KeyValueStorage,
  state: LibraryState,
  key: string = DOCUMENT_LIBRARY_STORAGE_KEY,
): Promise<void> {
  await storage.setItem(key, serializeLibraryState(state));
}

/**
 * Default storage wrapper — lazy-requires AsyncStorage so this module stays
 * import-clean under plain Node (harness / tsc --ignoreConfig).
 */
export function getDefaultLibraryStorage(): KeyValueStorage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage")
    .default as KeyValueStorage;
  return AsyncStorage;
}

// ── internals ──────────────────────────────────────────────────────────────

function sanitizeDoc(doc: LibraryDoc): LibraryDoc {
  const kind: LibraryDocKind = doc.kind === "txt" ? "txt" : "pdf";
  const out: LibraryDoc = {
    id: String(doc.id),
    name: typeof doc.name === "string" ? doc.name : "document",
    sourceId:
      typeof doc.sourceId === "string" && doc.sourceId.length > 0
        ? doc.sourceId
        : String(doc.id),
    kind,
    addedAt:
      typeof doc.addedAt === "number" && Number.isFinite(doc.addedAt)
        ? Math.floor(doc.addedAt)
        : Date.now(),
    sizeBytes:
      typeof doc.sizeBytes === "number" && Number.isFinite(doc.sizeBytes)
        ? Math.max(0, Math.floor(doc.sizeBytes))
        : 0,
    docCount:
      typeof doc.docCount === "number" && Number.isFinite(doc.docCount)
        ? Math.max(0, Math.floor(doc.docCount))
        : 0,
    fileUri: typeof doc.fileUri === "string" ? doc.fileUri : "",
  };
  if (
    typeof doc.pageCount === "number" &&
    Number.isFinite(doc.pageCount) &&
    doc.pageCount > 0
  ) {
    out.pageCount = Math.floor(doc.pageCount);
  }
  if (
    typeof doc.estimatedTokens === "number" &&
    Number.isFinite(doc.estimatedTokens) &&
    doc.estimatedTokens >= 0
  ) {
    out.estimatedTokens = Math.floor(doc.estimatedTokens);
  }
  if (
    doc.extractionStatus === "ok" ||
    doc.extractionStatus === "no_text_layer" ||
    doc.extractionStatus === "timeout" ||
    doc.extractionStatus === "renderer_error" ||
    doc.extractionStatus === "fs_error"
  ) {
    out.extractionStatus = doc.extractionStatus;
  }
  if (typeof doc.previewUri === "string" && doc.previewUri.length > 0) {
    out.previewUri = doc.previewUri;
  }
  return out;
}

function tryParseDoc(item: unknown): LibraryDoc | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (o.kind !== "pdf" && o.kind !== "txt") return null;
  const statusRaw = o.extractionStatus;
  const extractionStatus =
    statusRaw === "ok" ||
    statusRaw === "no_text_layer" ||
    statusRaw === "timeout" ||
    statusRaw === "renderer_error" ||
    statusRaw === "fs_error"
      ? statusRaw
      : undefined;
  return sanitizeDoc({
    id: o.id,
    name: typeof o.name === "string" ? o.name : "document",
    sourceId: typeof o.sourceId === "string" ? o.sourceId : o.id,
    kind: o.kind,
    addedAt: typeof o.addedAt === "number" ? o.addedAt : Date.now(),
    pageCount: typeof o.pageCount === "number" ? o.pageCount : undefined,
    sizeBytes: typeof o.sizeBytes === "number" ? o.sizeBytes : 0,
    docCount: typeof o.docCount === "number" ? o.docCount : 0,
    fileUri: typeof o.fileUri === "string" ? o.fileUri : "",
    estimatedTokens:
      typeof o.estimatedTokens === "number" ? o.estimatedTokens : undefined,
    ...(extractionStatus ? { extractionStatus } : {}),
    ...(typeof o.previewUri === "string" && o.previewUri.length > 0
      ? { previewUri: o.previewUri }
      : {}),
  });
}
