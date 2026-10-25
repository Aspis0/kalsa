import {
  runRetrievalLoop,
  type RetrievedPassage,
  DocRetrieverIndex,
} from "../context/retrievalLoop";
import { formatPassageCitation, type LibraryDoc } from "./DocumentLibrary";
import {
  DOCUMENT_CHAT_PROVENANCE,
  DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS,
  DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
  DOCUMENT_CHAT_TRUNC_MARKER,
} from "./documentChatConstants";
import { catalog } from "./documentChatCatalog";
import { denseDegradeLine, extractionScopeLine } from "./documentChatFormatting";
import { buildAnswerLanguageCue } from "./documentChatLanguage";
import { maybeRerankPassages, tryHybridRetrieve } from "./documentChatHybrid";
import type {
  DenseUnavailableReason,
  DocumentChatHost,
  DocumentChatToolResult,
  LoadedDocument,
} from "./documentChatTypes";

export async function runRetrieve(
  host: DocumentChatHost,
  doc: LibraryDoc,
  loaded: LoadedDocument,
  query: string,
  locale: "en" | "it",
  signal?: AbortSignal,
): Promise<DocumentChatToolResult> {
  let index =
    typeof host.getIndexFor === "function" ? host.getIndexFor(doc.id) : null;
  if (!index) {
    index = new DocRetrieverIndex();
    index.append(
      loaded.pages.map((p) => ({
        docId: p.docId,
        title: p.title ?? doc.name,
        text: p.text,
      })),
    );
    if (typeof host.setIndexFor === "function") host.setIndexFor(doc.id, index);
  }

  const { passages: bm25Passages } = runRetrievalLoop(index, query, {
    budgetChars: DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS,
  });
  let passages = bm25Passages;
  const hybridHostWired =
    typeof host.getSemanticIndexFor === "function" ||
    typeof host.isEmbedderDownloaded === "function" ||
    typeof host.embedQuery === "function";
  let strategy: DocumentChatToolResult["strategy"] = hybridHostWired
    ? "bm25_only"
    : "retrieve";
  let denseUnavailableReason: DenseUnavailableReason = null;

  const hybrid = await tryHybridRetrieve(host, doc, query, bm25Passages, signal);
  if (hybrid && hybrid.strategy === "hybrid") {
    passages = hybrid.passages;
    strategy = "hybrid";
    denseUnavailableReason =
      hybrid.denseUnavailableReason === "capped" ? "capped" : null;
  } else if (hybridHostWired) {
    strategy = "bm25_only";
    denseUnavailableReason =
      hybrid?.denseUnavailableReason ??
      (typeof host.getDenseUnavailableReason === "function"
        ? host.getDenseUnavailableReason(doc.id)
        : null) ??
      "no_embedder";
  }

  if (!passages.length) {
    const degradeLine = denseDegradeLine(locale, denseUnavailableReason);
    const base = catalog(locale).nothingMatched.replace("{name}", doc.name);
    const scope = extractionScopeLine(locale, doc, loaded);
    const lines = [base, scope, degradeLine].filter(Boolean) as string[];
    return {
      text: lines.join("\n\n"),
      passages: [],
      provenance: DOCUMENT_CHAT_PROVENANCE,
      strategy:
        strategy === "hybrid"
          ? "hybrid"
          : hybridHostWired
            ? "bm25_only"
            : "retrieve",
      kind: "document_chat",
      denseUnavailableReason,
    };
  }

  passages = await maybeRerankPassages(query, passages);
  const packed = packPassagesToBudget(passages, DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS);
  let body = packed
    .map((p, i) => {
      const cite = formatPassageCitation(p.docId);
      const label = cite ? ` (${cite})` : "";
      return `${i + 1}.${label} ${p.text}`;
    })
    .join("\n\n");

  const header = catalog(locale).retrieveHeader.replace("{name}", doc.name);
  const scope = extractionScopeLine(locale, doc, loaded);
  const degradeLine = denseDegradeLine(locale, denseUnavailableReason);
  const cue = buildAnswerLanguageCue(locale);
  const head = [header, scope, degradeLine].filter(Boolean).join("\n\n");
  const maxBody = DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS - head.length - cue.length - 4;
  if (body.length > maxBody) {
    const sliceLen = Math.max(0, maxBody - DOCUMENT_CHAT_TRUNC_MARKER.length);
    body = body.slice(0, sliceLen) + DOCUMENT_CHAT_TRUNC_MARKER;
  }
  const text = [head, body, cue].filter(Boolean).join("\n\n");

  return {
    text,
    passages: packed,
    provenance: DOCUMENT_CHAT_PROVENANCE,
    strategy,
    kind: "document_chat",
    denseUnavailableReason,
  };
}

export function packPassagesToBudget(
  passages: RetrievedPassage[],
  budgetChars: number,
): RetrievedPassage[] {
  if (!Array.isArray(passages) || passages.length === 0) return [];
  const budget =
    typeof budgetChars === "number" && Number.isFinite(budgetChars) && budgetChars > 0
      ? budgetChars
      : DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS;
  const out: RetrievedPassage[] = [];
  let used = 0;
  for (const p of passages) {
    const len = typeof p.text === "string" ? p.text.length : 0;
    if (out.length > 0 && used + len > budget) break;
    out.push(p);
    used += len;
  }
  return out.length > 0 ? out : passages.slice(0, 1);
}
