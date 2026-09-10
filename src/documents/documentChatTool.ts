export {
  DOCUMENT_CHAT_PROVENANCE,
  DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
  DOCUMENT_CHAT_TIMEOUT_MS,
  DOC_OP_STALE_CAP_MS,
  DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS,
  DOCUMENT_CHAT_FULL_CONTEXT_MAX_CHARS,
  MAX_FIRST_WORD_WAIT_MS,
  PREFILL_BUDGET_FALLBACK_TOKENS,
  DOCUMENT_CHAT_VISION_MARKER,
  HYBRID_DENSE_TOP_N,
  HYBRID_FINAL_TOP_K,
  HYBRID_RRF_K,
  HYBRID_RERANK_ENABLED,
} from "./documentChatConstants";
export { buildAnswerLanguageCue } from "./documentChatLanguage";
export { DOCUMENT_CHAT_TOOL } from "./documentChatSchema";
export { buildRerankPrompt, maybeRerankPassages } from "./documentChatHybrid";
export {
  isDocumentChatBusy,
  isDocumentOpInFlight,
  __resetDocumentChatBusyForTests,
  createDocumentChatExecutor,
} from "./documentChatExecutor";
export { packPassagesToBudget } from "./documentChatRetrieval";
export { retrieveLibraryPassages } from "./documentChatHarvest";
export { selectDoc } from "./documentChatSelection";

export type {
  DocumentChatToolDef,
  DenseUnavailableReason,
  DocumentChatToolResult,
  DocumentChatHost,
  ActiveDocumentAttachment,
  DocumentChatExecute,
  LibraryRetrieveResult,
  SelectDocResult,
} from "./documentChatTypes";
