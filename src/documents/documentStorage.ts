/**
 * Document library storage helpers — pure ownership/size predicates +
 * durable FS paths under documentDirectory/kalsa-documents/.
 *
 * Pure helpers are free of React Native side effects other than the
 * FileSystem-backed async functions (documentsDir, copy, delete, size).
 * Harness mirrors the pure predicates in documentLibraryHarness.mjs.
 */

import * as FileSystem from "expo-file-system/legacy";

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
 * the canonical library prefix (normalized baseDir + "kalsa-documents/").
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
  const canonicalPrefix = `${basePrefix}kalsa-documents/`;
  // Exact library dir or a file/dir under it.
  return (
    normUri === canonicalPrefix.slice(0, -1) ||
    normUri.startsWith(canonicalPrefix)
  );
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

export async function ensureDocumentsDir(): Promise<string> {
  const dir = documentsDir();
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    /* exists */
  }
  return dir;
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
