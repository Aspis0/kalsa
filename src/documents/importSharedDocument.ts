/**
 * Import a shared local file into the document library (same path as picking
 * a PDF): copy to owned storage, extract text, build a LibraryDoc.
 */

import { MAX_PDF_PAGES } from "../util/pdfBridgeProtocol";
import { requestPdfText } from "../pdf/pdfTextService";
import {
  estimateTokensForDoc,
  type ExtractionStatus,
  type LibraryDoc,
} from "./DocumentLibrary";
import {
  copyToOwnedStorage,
  deleteOwnedFile,
  resolveAssetSizeBytes,
  sizeWithinLimits,
} from "./documentStorage";

export type SharedImportErrorCode =
  | "too_large"
  | "empty"
  | "unknown"
  | "storage"
  | "busy"
  | "failed";

export class SharedImportError extends Error {
  readonly code: SharedImportErrorCode;
  constructor(code: SharedImportErrorCode, message?: string) {
    super(message || code);
    this.name = "SharedImportError";
    this.code = code;
  }
}

function nextSharedDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function displayNameFromUri(uri: string, fallback: string): string {
  const trimmed = typeof fallback === "string" ? fallback.trim() : "";
  if (trimmed) return trimmed;
  try {
    const path = uri.split("?")[0] ?? uri;
    const last = path.split("/").pop() ?? "";
    const decoded = decodeURIComponent(last);
    return decoded || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

export async function importSharedPdf(
  sourceUri: string,
  nameHint?: string,
): Promise<LibraryDoc> {
  if (!sourceUri || typeof sourceUri !== "string") {
    throw new SharedImportError("failed");
  }
  const sizeBytes = await resolveAssetSizeBytes(sourceUri);
  const sizeCheck = sizeWithinLimits(sizeBytes, "pdf");
  if (!sizeCheck.ok) {
    throw new SharedImportError(sizeCheck.reason === "too_large" ? "too_large" : sizeCheck.reason);
  }
  const id = nextSharedDocId();
  const name = displayNameFromUri(sourceUri, nameHint ?? "");
  let ownedUri: string;
  try {
    ownedUri = await copyToOwnedStorage(sourceUri, id, "pdf");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SharedImportError(msg === "NO_DOCUMENT_DIRECTORY" ? "storage" : "failed");
  }

  let docCount = 0;
  let pageCount: number | undefined;
  let estimatedTokens: number | undefined;
  let extractionStatus: ExtractionStatus = "ok";

  try {
    const extracted = await requestPdfText(ownedUri, {
      sourceId: id,
      title: name,
    });
    const extractedDocs = Array.isArray(extracted?.docs) ? extracted.docs : [];
    docCount = extractedDocs.filter(
      (d) => d && typeof d.text === "string" && d.text.trim().length > 0,
    ).length;
    const extractedPages = extractedDocs.length + (extracted?.skippedPages?.length ?? 0);
    if (extractedPages > 0) {
      pageCount = extractedPages;
    } else if (
      typeof extracted?.documentPageCount === "number" &&
      extracted.documentPageCount > 0
    ) {
      pageCount = Math.min(Math.floor(extracted.documentPageCount), MAX_PDF_PAGES);
    }
    const fullText = extractedDocs.map((d) => d.text ?? "").join("\n\n");
    estimatedTokens = estimateTokensForDoc(fullText);
    extractionStatus = docCount === 0 ? "no_text_layer" : "ok";
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "busy") {
      await deleteOwnedFile(ownedUri).catch(() => undefined);
      throw new SharedImportError("busy");
    }
    if (code === "timeout" || code === "page_timeout") {
      extractionStatus = "timeout";
    } else if (
      code === "renderer_gone" ||
      code === "no_host" ||
      code === "unmounted" ||
      code === "failed"
    ) {
      extractionStatus = "renderer_error";
    } else {
      extractionStatus = "fs_error";
    }
  }

  return {
    id,
    name,
    sourceId: id,
    kind: "pdf",
    addedAt: Date.now(),
    sizeBytes: sizeCheck.sizeBytes,
    docCount,
    fileUri: ownedUri,
    extractionStatus,
    ...(pageCount != null ? { pageCount } : {}),
    ...(estimatedTokens != null ? { estimatedTokens } : {}),
  };
}
