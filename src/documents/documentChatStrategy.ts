import { getPrefillTokPerSec, prefillBudgetTokens } from "../engine/prefillSpeed";
import type { Locale } from "../i18n/types";
import {
  decideDocStrategy,
  estimateTokensForDoc,
  shouldUseVisionFallback,
  type LibraryDoc,
} from "./DocumentLibrary";
import {
  DOCUMENT_CHAT_PROVENANCE,
  DOCUMENT_CHAT_VISION_MARKER,
  MAX_FIRST_WORD_WAIT_MS,
  PREFILL_BUDGET_FALLBACK_TOKENS,
} from "./documentChatConstants";
import { catalog } from "./documentChatCatalog";
import { formatFullContext } from "./documentChatFullContext";
import { getHostModelId, loadDocText } from "./documentChatHost";
import { errorResult } from "./documentChatResults";
import { runRetrieve } from "./documentChatRetrieval";
import type {
  DocumentChatHost,
  DocumentChatToolResult,
} from "./documentChatTypes";

export async function runStrategy(
  host: DocumentChatHost,
  doc: LibraryDoc,
  query: string,
  locale: Locale,
  signal?: AbortSignal,
): Promise<DocumentChatToolResult> {
  const ctxTokens =
    typeof host.getCtxTokens === "function" ? host.getCtxTokens() : 0;
  const modelId = getHostModelId(host);
  const tokPerSec = getPrefillTokPerSec(modelId);
  const budgetTokens = prefillBudgetTokens(
    modelId,
    MAX_FIRST_WORD_WAIT_MS,
    PREFILL_BUDGET_FALLBACK_TOKENS,
  );
  let estimatedTokens =
    typeof doc.estimatedTokens === "number" && Number.isFinite(doc.estimatedTokens)
      ? doc.estimatedTokens
      : null;

  if (!shouldUseVisionFallback(doc) && (doc.docCount ?? 0) <= 0) {
    const status = doc.extractionStatus;
    const msg = extractionErrorMessage(locale, doc, status);
    const reason =
      status === "timeout" || status === "renderer_error" || status === "fs_error"
        ? status
        : null;
    return errorResult(msg, reason);
  }

  let strategy = decideDocStrategy({
    docCount: doc.docCount,
    estimatedTokens,
    ctxTokens,
    prefillBudgetTokens: budgetTokens,
  });
  if (strategy === "vision_fallback") return visionFallback(doc, locale);
  if (signal?.aborted) throw new Error("document_chat aborted");

  const loaded = await loadDocText(host, doc, signal);
  if (loaded.kind === "error") return errorResult(loaded.message);
  if (loaded.docCount === 0) {
    if (!shouldUseVisionFallback(doc)) {
      const status = doc.extractionStatus;
      const msg = extractionErrorMessage(locale, doc, status);
      const reason =
        status === "timeout" || status === "renderer_error" || status === "fs_error"
          ? status
          : null;
      return errorResult(msg, reason);
    }
    return visionFallback(doc, locale, loaded.pageCount);
  }

  if (estimatedTokens == null) estimatedTokens = estimateTokensForDoc(loaded.fullText);
  strategy = decideDocStrategy({
    docCount: loaded.docCount,
    estimatedTokens,
    ctxTokens,
    prefillBudgetTokens: budgetTokens,
  });

  console.log(
    `KALSA_DOC_STRATEGY ${JSON.stringify({
      strategy,
      estTokens: estimatedTokens,
      ctx: ctxTokens,
      budgetTokens,
      tokPerSec,
    })}`,
  );

  if (strategy === "full_context") return formatFullContext(doc, loaded, locale);
  return await runRetrieve(host, doc, loaded, query, locale, signal);
}

function visionFallback(
  doc: LibraryDoc,
  locale: Locale,
  pageCount?: number,
): DocumentChatToolResult {
  return {
    text:
      `${DOCUMENT_CHAT_VISION_MARKER}\n` +
      catalog(locale).visionFallback
        .replace("{name}", doc.name)
        .replace("{pages}", String(doc.pageCount ?? pageCount ?? "?")),
    passages: [],
    provenance: DOCUMENT_CHAT_PROVENANCE,
    strategy: "vision_fallback",
    kind: "document_chat",
  };
}

function extractionErrorMessage(
  locale: Locale,
  doc: LibraryDoc,
  status: LibraryDoc["extractionStatus"],
): string {
  const strings = catalog(locale);
  if (status === "timeout") return strings.extractTimeout.replace("{name}", doc.name);
  if (status === "renderer_error") {
    return strings.extractRenderer.replace("{name}", doc.name);
  }
  if (status === "fs_error") return strings.extractFs.replace("{name}", doc.name);
  return strings.extractFailed.replace("{name}", doc.name);
}
