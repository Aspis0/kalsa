import type { Locale } from "../i18n/types";
import type { LibraryDoc } from "./DocumentLibrary";
import {
  DOCUMENT_CHAT_PROVENANCE,
  DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
  DOCUMENT_CHAT_TRUNC_MARKER,
} from "./documentChatConstants";
import { catalog } from "./documentChatCatalog";
import { extractionScopeLine } from "./documentChatFormatting";
import { buildAnswerLanguageCue } from "./documentChatLanguage";
import type {
  DocumentChatToolResult,
  LoadedDocument,
} from "./documentChatTypes";

export function formatFullContext(
  doc: LibraryDoc,
  loaded: LoadedDocument,
  locale: Locale,
): DocumentChatToolResult {
  // Runtime extraction metadata wins over a legacy record that may still have
  // the former five-page value.
  const pages =
    loaded.pageCount ??
    doc.pageCount ??
    (doc.kind === "pdf" ? loaded.pages.length : undefined);
  const header = catalog(locale).fullContextHeader
    .replace("{name}", doc.name)
    .replace("{pages}", pages != null ? String(pages) : "—");
  const scope = extractionScopeLine(locale, doc, loaded);
  const head = scope ? `${header}\n${scope}` : header;
  const cue = buildAnswerLanguageCue(locale);
  let body = loaded.fullText;

  // Keep the cue at the end of the body after LlamaService's end truncation.
  const maxBody = DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS - head.length - cue.length - 4;
  if (body.length > maxBody) {
    const sliceLen = Math.max(0, maxBody - DOCUMENT_CHAT_TRUNC_MARKER.length);
    body = body.slice(0, sliceLen) + DOCUMENT_CHAT_TRUNC_MARKER;
  }
  const text = `${head}\n\n${body}\n\n${cue}`;

  return {
    text,
    passages: [],
    provenance: DOCUMENT_CHAT_PROVENANCE,
    strategy: "full_context",
    kind: "document_chat",
  };
}
