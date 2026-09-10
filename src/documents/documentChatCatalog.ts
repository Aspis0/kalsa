import { en } from "../i18n/en";
import { it } from "../i18n/it";
import type { Locale } from "../i18n/types";

export function catalog(locale: Locale): {
  emptyQuery: string;
  noDoc: string;
  docNotFound: string;
  docFallbackSingle: string;
  timeout: string;
  aborted: string;
  failed: string;
  visionFallback: string;
  fullContextHeader: string;
  retrieveHeader: string;
  nothingMatched: string;
  extractTimeout: string;
  extractRenderer: string;
  extractFs: string;
  extractFailed: string;
} {
  // Prefer i18n keys when present; fall back to English literals so the
  // harness stays independent of incomplete locale trees during development.
  const errors = (locale === "it" ? it : en).errors as Record<string, string>;
  return {
    emptyQuery:
      errors.documentChatEmptyQuery ??
      "document_chat requires a non-empty query.",
    noDoc:
      errors.documentChatNoDoc ??
      "No local document is available. Add a PDF or TXT in Documents, or pass docId.",
    docNotFound:
      errors.documentChatDocNotFound ??
      "Document not found in the library (id={id}).",
    docFallbackSingle:
      errors.documentChatDocFallbackSingle ??
      "Document not found in the library (id={id}); using the only available document “{name}” instead.",
    timeout: errors.documentChatTimeout ?? "document_chat timed out.",
    aborted: errors.documentChatAborted ?? "document_chat was aborted.",
    failed: errors.documentChatFailed ?? "document_chat failed.",
    visionFallback:
      errors.documentChatVisionFallback ??
      "Document “{name}” has no searchable text layer ({pages} pages). It appears scanned — re-attach it as page images for vision.",
    fullContextHeader:
      errors.documentChatFullContextHeader ??
      "Full text of local document “{name}” ({pages} pages):",
    retrieveHeader:
      errors.documentChatRetrieveHeader ??
      "Passages from local document “{name}”:",
    nothingMatched:
      errors.documentChatNothingMatched ??
      "No passages in “{name}” matched the query.",
    extractTimeout:
      errors.documentChatExtractTimeout ??
      "Text extraction for “{name}” timed out. Ask the user to re-import the document from Documents (retry); do not treat it as a scanned PDF.",
    extractRenderer:
      errors.documentChatExtractRenderer ??
      "Text extraction for “{name}” failed (renderer error). Ask the user to re-import from Documents; do not use vision fallback.",
    extractFs:
      errors.documentChatExtractFs ??
      "Text extraction for “{name}” failed (file read error). Ask the user to re-import from Documents.",
    extractFailed:
      errors.documentChatExtractFailed ??
      "Text extraction for “{name}” failed. Ask the user to re-import from Documents (retry).",
  };
}
