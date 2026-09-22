/**
 * The Word import behind the attach sheet's "PDF or Word" row when the pick
 * is a .docx: read the text, check both caps, write the owned copy, add it to
 * the library and attach it as a retrieval source — the controller's
 * `importAndAttachDocx` (`AiChatPage.tsx:3723-3830`) with its ports where it
 * touches the filesystem, the store or the notice, so every refusal keeps the
 * controller's catalogue line and is testable in node.
 *
 * Order is the contract: cap → `documents.importingWord` → container size →
 * extract → inflated-text size → cap again → write → library → attach, with
 * an owned file deleted on every path that does not commit it.
 */
import type { TranslationKey } from "../i18n";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import { MAX_ATTACHMENT_ITEMS, PDF_CAP_NOTICE } from "./attachments";

export interface DocxAttachPorts {
  /** The live row count (checked before the import and again before commit). */
  count: () => number;
  notice: (key: TranslationKey, params?: Record<string, string | number>) => void;
  /** `resolveAssetSizeBytes` — the picked container's size, or null. */
  resolveSizeBytes: (uri: string) => Promise<number | null>;
  /** `sizeWithinLimits(bytes, "docx" | "txt")` — the controller's two caps:
   *  50 MiB container, 10 MiB inflated text. */
  withinLimits: (
    bytes: number | null,
    kind: "docx" | "txt",
  ) => { ok: boolean; reason?: "empty" | "too_large" | string };
  /** `extractDocxTextFromFile`, rejecting with a `DocxExtractError`-shaped
   *  `code` (`DOCX_EMPTY` / `DOCX_TOO_LARGE` / anything else). */
  extractText: (uri: string) => Promise<string>;
  /** The localized `formatBytesLocalized(MAX_*_BYTES, locale)` labels. */
  containerCapLabel: string;
  textCapLabel: string;
  /** The inflated text measured as UTF-8 bytes (controller's TextEncoder). */
  byteLength: (text: string) => number;
  nextDocId: () => string;
  /** `writeOwnedText(id, text)` — rejects with `NO_DOCUMENT_DIRECTORY`. */
  writeOwnedText: (id: string, text: string) => Promise<string>;
  deleteOwnedFile: (uri: string) => Promise<void>;
  /** The library's `addDocument`; false when the delete gate held it. */
  addDocument: (entry: LibraryDoc) => boolean;
  /** The same library add the composer rows take (dedupe + cap) — its
   *  outcome is the row hook's business; the import has already checked the
   *  cap, so reaching this point means added or duplicate. */
  attachDocument: (doc: { id: string; name: string }) => void;
  now: () => number;
  /** `estimateTokensForDoc(text)`. */
  estimateTokens: (text: string) => number;
  /** False when the component unmounted mid-import: the owned file is cleaned
   *  up and nothing commits (the controller's `mountedRef` guards). */
  isMounted: () => boolean;
}

/** Returns false only when the import bailed before attaching (any refusal —
 *  each already served its notice). The caller's busy flag wraps this. */
export async function importAndAttachDocx(
  uri: string,
  name: string,
  ports: DocxAttachPorts,
): Promise<boolean> {
  if (!ports.isMounted()) return false;
  if (ports.count() >= MAX_ATTACHMENT_ITEMS) {
    ports.notice(PDF_CAP_NOTICE, { max: MAX_ATTACHMENT_ITEMS });
    return false;
  }
  ports.notice("documents.importingWord");

  const resolvedSize = await ports.resolveSizeBytes(uri);
  if (!ports.isMounted()) return false;
  // Images inside the zip are skipped; the 50 MiB cap is the container, the
  // 10 MiB cap is the inflated text.
  const sizeCheck = ports.withinLimits(resolvedSize, "docx");
  if (!sizeCheck.ok) {
    if (sizeCheck.reason === "empty") ports.notice("documents.errorEmpty");
    else if (sizeCheck.reason === "too_large") {
      ports.notice("documents.errorTooLarge", { max: ports.containerCapLabel });
    } else ports.notice("documents.errorDocx");
    return false;
  }

  let text: string;
  try {
    text = await ports.extractText(uri);
  } catch (error) {
    if (!ports.isMounted()) return false;
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "DOCX_EMPTY") ports.notice("documents.errorEmpty");
    else if (code === "DOCX_TOO_LARGE") {
      ports.notice("documents.errorTooLarge", { max: ports.textCapLabel });
    } else ports.notice("documents.errorDocx");
    return false;
  }
  if (!ports.isMounted()) return false;
  if (ports.byteLength(text) > TXT_CAP_BYTES) {
    ports.notice("documents.errorTooLarge", { max: ports.textCapLabel });
    return false;
  }
  if (ports.count() >= MAX_ATTACHMENT_ITEMS) {
    ports.notice(PDF_CAP_NOTICE, { max: MAX_ATTACHMENT_ITEMS });
    return false;
  }

  const id = ports.nextDocId();
  let ownedUri: string;
  try {
    ownedUri = await ports.writeOwnedText(id, text);
  } catch (error) {
    if (!ports.isMounted()) return false;
    const message = error instanceof Error ? error.message : String(error);
    ports.notice(
      message === "NO_DOCUMENT_DIRECTORY" ? "documents.errorStorage" : "documents.errorDocx",
    );
    return false;
  }
  if (!ports.isMounted()) {
    await ports.deleteOwnedFile(ownedUri);
    return false;
  }
  const entry: LibraryDoc = {
    id,
    name,
    sourceId: id,
    kind: "txt",
    addedAt: ports.now(),
    sizeBytes: ports.byteLength(text),
    docCount: 1,
    fileUri: ownedUri,
    extractionStatus: "ok",
    estimatedTokens: ports.estimateTokens(text),
  };
  if (!ports.addDocument(entry)) {
    await ports.deleteOwnedFile(ownedUri);
    ports.notice("documents.errorBusy");
    return false;
  }
  ports.attachDocument({ id, name });
  return true;
}

/** The inflated-text cap in bytes — `MAX_TEXT_BYTES` mirrored from
 *  `documentStorage.ts:20`, which this file cannot import (expo sits at the
 *  top of that module, and the node tests must load this one). The mirror is
 *  pinned against the source by `docxAttach.test.ts`, so the constant cannot
 *  drift without the test saying so. */
export const TXT_CAP_BYTES = 10 * 1024 * 1024;
