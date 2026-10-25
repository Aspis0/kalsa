import { en } from "../i18n/en";
import { it } from "../i18n/it";
import type { Locale } from "../i18n/types";
import type { DenseUnavailableReason } from "./documentChatTypes";
import type { LibraryDoc } from "./DocumentLibrary";

export function extractionScopeLine(
  locale: Locale,
  doc: LibraryDoc,
  loaded: { pageCount?: number; processedPageCount?: number; truncated?: boolean },
): string | null {
  if (!doc.truncated && !loaded.truncated) return null;
  const total = loaded.pageCount ?? doc.pageCount;
  const processed = loaded.processedPageCount ?? doc.processedPageCount;
  if (
    typeof total === "number" &&
    total > 0 &&
    typeof processed === "number" &&
    processed >= 0 &&
    processed < total
  ) {
    return locale === "it"
      ? `L'estrazione del testo include solo le prime ${processed} di ${total} pagine.`
      : `Text extraction includes only the first ${processed} of ${total} pages.`;
  }
  if (typeof processed === "number" && processed >= 0) {
    return locale === "it"
      ? `L'estrazione del testo è stata troncata dopo ${processed} pagine.`
      : `Text extraction was truncated after ${processed} pages.`;
  }
  return locale === "it"
    ? "L'estrazione del testo è stata troncata."
    : "Text extraction was truncated.";
}

export function denseDegradeLine(
  locale: Locale,
  reason: DenseUnavailableReason,
): string | null {
  if (!reason) return null;
  const pack = locale === "it" ? it : en;
  const emb = pack.embedding as {
    degradedCap?: string;
    degradedCorrupt?: string;
    degradedNoEmbedder?: string;
  };
  const extraction = (pack as { documents?: { extraction?: {
    timeout?: string;
    renderer?: string;
    fsError?: string;
    retryHint?: string;
  } } }).documents?.extraction;
  if (reason === "cap" || reason === "capped") return emb.degradedCap ?? null;
  if (reason === "corrupt") return emb.degradedCorrupt ?? null;
  if (reason === "no_embedder" || reason === "hung") {
    return emb.degradedNoEmbedder ?? null;
  }
  if (reason === "timeout") return extraction?.timeout ?? null;
  if (reason === "renderer_error") return extraction?.renderer ?? null;
  if (reason === "fs_error") return extraction?.fsError ?? null;
  return null;
}
