/**
 * Document library storage helpers — pure ownership/size predicates +
 * durable FS paths under documentDirectory/kalsa-documents/.
 *
 * Pure helpers are free of React Native side effects other than the
 * FileSystem-backed async functions (documentsDir, copy, delete, size).
 * Harness mirrors the pure predicates in documentLibraryHarness.mjs.
 */

import * as FileSystem from "expo-file-system/legacy";

import { makePreviewSnippet } from "./DocumentLibrary";

/**
 * Hard size caps before extraction / full-text read.
 * PDF 50 MiB: upper bound for on-device page extract without OOMing mid-tier phones.
 * TXT 10 MiB: whole-file JS string; larger inputs belong in retrieve-from-PDF path.
 */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 10 * 1024 * 1024;

/**
 * Normalize a file URI/path for ownership checks:
 * - backslashes → "/"
 * - collapse "." segments
 * - resolve ".." via a stack (clamp at root; never emit escaping "..")
 * Exported for harness coverage.
 */
export function normalizeUriPath(uri: string): string {
  if (!uri || typeof uri !== "string") return "";
  const s = uri.replace(/\\/g, "/");
  // Preserve scheme + hierarchical part (file://, content://, etc.).
  const schemeMatch = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/);
  const scheme = schemeMatch ? schemeMatch[1] : "";
  const pathPart = schemeMatch ? schemeMatch[2] : s;
  const leadingSlash = pathPart.startsWith("/");
  const stack: string[] = [];
  for (const seg of pathPart.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // Clamp: never allow ".." to escape above root of this path.
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const body = stack.join("/");
  if (scheme) {
    // file:// + / + body → file:///body (absolute under hierarchical scheme)
    return `${scheme}/${body}`;
  }
  return (leadingSlash ? "/" : "") + body;
}

/**
 * Pure ownership predicate: after path normalization, fileUri must START WITH
 * a canonical owned prefix under documentDirectory:
 *   - kalsa-documents/  (library files + vector sidecars)
 *   - kalsa-covers/     (page-1 cover JPEGs)
 * baseDir is the durable root (documentDirectory), NOT the library subfolder.
 * Traversal / backslash spoofing is rejected via normalizeUriPath.
 * Exported for harness coverage.
 */
export function isOwnedDocumentUri(
  fileUri: string,
  baseDir: string,
): boolean {
  if (!fileUri || typeof fileUri !== "string") return false;
  if (!baseDir || typeof baseDir !== "string") return false;
  const normUri = normalizeUriPath(fileUri);
  const normBase = normalizeUriPath(baseDir);
  if (!normUri || !normBase) return false;
  const basePrefix = normBase.endsWith("/") ? normBase : `${normBase}/`;
  const ownedPrefixes = [
    `${basePrefix}kalsa-documents/`,
    `${basePrefix}kalsa-covers/`,
  ];
  for (const canonicalPrefix of ownedPrefixes) {
    if (
      normUri === canonicalPrefix.slice(0, -1) ||
      normUri.startsWith(canonicalPrefix)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Pure size-limit check against resolved byte length.
 * null/undefined/non-finite → rejected (fail closed on unknown size).
 * zero bytes → rejected as empty.
 * Exported for harness coverage.
 */
export function sizeWithinLimits(
  sizeBytes: number | null | undefined,
  kind: "pdf" | "txt",
): {
  ok: true;
  sizeBytes: number;
} | { ok: false; reason: "unknown" | "too_large" | "empty" } {
  if (
    sizeBytes == null ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0
  ) {
    return { ok: false, reason: "unknown" };
  }
  const max = kind === "pdf" ? MAX_DOCUMENT_BYTES : MAX_TEXT_BYTES;
  const n = Math.floor(sizeBytes);
  if (n === 0) return { ok: false, reason: "empty" };
  if (n > max) return { ok: false, reason: "too_large" };
  return { ok: true, sizeBytes: n };
}

/**
 * Durable library storage under documentDirectory only.
 * NEVER falls back to cacheDirectory (cache is evictable).
 * Throws when documentDirectory is unavailable so import aborts cleanly.
 */
export function documentsDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error("NO_DOCUMENT_DIRECTORY");
  }
  return `${base}kalsa-documents/`;
}

/** Durable cover JPEG directory under documentDirectory/kalsa-covers/. */
export function coversDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error("NO_DOCUMENT_DIRECTORY");
  }
  return `${base}kalsa-covers/`;
}

export async function ensureDocumentsDir(): Promise<string> {
  const dir = documentsDir();
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  return dir;
}

export async function ensureCoversDir(): Promise<string> {
  const dir = coversDir();
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  return dir;
}

/** Absolute durable path for a page-1 cover JPEG. Throws if no documentDirectory. */
export function coverPath(docId: string): string {
  if (!docId || typeof docId !== "string") {
    throw new Error("coverPath: docId required");
  }
  const safe = docId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) throw new Error("coverPath: empty safe id");
  return `${coversDir()}${safe}.jpg`;
}

export async function copyToOwnedStorage(
  sourceUri: string,
  id: string,
  kind: "pdf" | "txt",
): Promise<string> {
  const dir = await ensureDocumentsDir();
  const ext = kind === "pdf" ? "pdf" : "txt";
  const dest = `${dir}${id}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

/**
 * Resolve actual size via getInfoAsync. Fail closed when size cannot be established.
 * Returns null when exists is false or size is missing/non-finite.
 */
export async function resolveAssetSizeBytes(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) return null;
    const size = (info as { size?: number }).size;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      return null;
    }
    return Math.floor(size);
  } catch {
    return null;
  }
}

/**
 * Delete a library-owned file only. Non-owned / legacy / traversal URIs are ignored.
 */
export async function deleteOwnedFile(fileUri: string | undefined): Promise<void> {
  if (!fileUri || typeof fileUri !== "string") return;
  // Canonical ownership: only delete under documentDirectory/kalsa-documents/.
  // baseDir is documentDirectory (root); isOwnedDocumentUri appends kalsa-documents/.
  // Legacy / non-owned URIs (cache, content://, traversal spoofs) are NEVER deleted.
  const root = FileSystem.documentDirectory;
  if (!root) {
    // No durable dir available — refuse filesystem delete (metadata-only).
    return;
  }
  if (!isOwnedDocumentUri(fileUri, root)) return;
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    /* best-effort */
  }
}

// ── Durable semantic-vector sidecars ({docId}.vec.json) ─────────────────────
//
// Flat JSON next to the owned document under kalsa-documents/. Shape is
// SemanticVectorIndex.toJSON() (dims + vectors[{chunkId, vector, text?, contentHash?}]).
// Corrupt / missing files are best-effort skipped by callers (BM25-only).

/** Absolute durable path for a per-doc vector sidecar. Throws if no documentDirectory. */
export function vectorIndexPath(docId: string): string {
  if (!docId || typeof docId !== "string") {
    throw new Error("vectorIndexPath: docId required");
  }
  // Sanitize path segments — only keep [A-Za-z0-9._-] so a malicious id cannot
  // escape kalsa-documents/.
  const safe = docId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) throw new Error("vectorIndexPath: empty safe id");
  return `${documentsDir()}${safe}.vec.json`;
}

/**
 * Best-effort atomic write of a SemanticVectorIndex JSON payload. Never throws.
 *
 * Atomicity: write to `<path>.tmp`, then replace the final path. expo-file-system
 * `moveAsync` fails when the destination exists, so we use the same
 * dest→.bak / tmp→dest / drop-.bak pattern as LlamaService session saves
 * (no delete-then-move loss window). On any failure only the .tmp is cleaned;
 * the previous good `.vec.json` (if any) stays intact. Readers ignore missing
 * / corrupt files and leftover `.tmp` (never read the tmp path).
 */
export async function writeVectorIndexFile(
  docId: string,
  json: unknown,
): Promise<void> {
  let tmpPath: string | null = null;
  try {
    if (!docId || typeof docId !== "string") return;
    await ensureDocumentsDir();
    const path = vectorIndexPath(docId);
    tmpPath = `${path}.tmp`;
    const bakPath = `${path}.bak`;
    const body = JSON.stringify(json);

    // Drop any stale tmp from a previous interrupted write.
    try {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    } catch {
      /* ignore */
    }

    await FileSystem.writeAsStringAsync(tmpPath, body, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // moveAsync does not overwrite an existing dest — backup-rename first.
    try {
      await FileSystem.deleteAsync(bakPath, { idempotent: true });
    } catch {
      /* ignore */
    }
    let hadPrevious = false;
    try {
      const prev = await FileSystem.getInfoAsync(path);
      hadPrevious = !!prev.exists;
      if (hadPrevious) await FileSystem.moveAsync({ from: path, to: bakPath });
    } catch {
      hadPrevious = false;
    }
    try {
      await FileSystem.moveAsync({ from: tmpPath, to: path });
      tmpPath = null; // moved; no longer needs cleanup
    } catch (moveError) {
      // Restore previous good file if we had one.
      if (hadPrevious) {
        try {
          await FileSystem.moveAsync({ from: bakPath, to: path });
        } catch {
          /* ignore — worst case BM25-only until next embed */
        }
      }
      throw moveError;
    }
    try {
      await FileSystem.deleteAsync(bakPath, { idempotent: true });
    } catch {
      /* ignore leftover bak */
    }
  } catch {
    /* best-effort: clean tmp if still present */
    if (tmpPath) {
      try {
        await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/** Best-effort load. Returns null on missing/corrupt/unreadable. */
export async function readVectorIndexFile(
  docId: string,
): Promise<unknown | null> {
  try {
    if (!docId || typeof docId !== "string") return null;
    const path = vectorIndexPath(docId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Best-effort delete of the vector sidecar for a library doc. */
export async function deleteVectorIndexFile(docId: string): Promise<void> {
  try {
    if (!docId || typeof docId !== "string") return;
    const path = vectorIndexPath(docId);
    await deleteOwnedFile(path);
  } catch {
    /* best-effort */
  }
}

/**
 * Lazy-read a TXT library entry prefix and return a 200-code-point preview
 * snippet (or null). Used by detail view on open — never stored in library
 * JSON (Q5 final). Reads the full file then slices the first 4 KB of text;
 * partial UTF-8 reads are not supported by expo-file-system EncodingType.UTF8.
 */
export async function readPreviewSnippet(doc: {
  kind?: string;
  fileUri?: string;
}): Promise<string | null> {
  try {
    if (!doc || doc.kind !== "txt") return null;
    const uri = doc.fileUri;
    if (!uri || typeof uri !== "string") return null;
    let raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (typeof raw !== "string" || raw.length === 0) return null;
    // Reject binary-looking content (NUL in prefix).
    if (raw.includes("\u0000")) return null;
    if (raw.length > 4096) raw = raw.slice(0, 4096);
    // HTML-ish → strip tags lightly (same heuristic as import path).
    const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 512));
    let plain = raw;
    if (looksHtml) {
      plain = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ");
    }
    const snip = makePreviewSnippet(plain);
    return snip ?? null;
  } catch {
    return null;
  }
}
