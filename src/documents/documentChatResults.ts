import { DOCUMENT_CHAT_PROVENANCE } from "./documentChatConstants";
import type {
  DenseUnavailableReason,
  DocumentChatToolResult,
} from "./documentChatTypes";

export function errorResult(
  message: string,
  denseUnavailableReason: DenseUnavailableReason = null,
): DocumentChatToolResult {
  return {
    text: message,
    passages: [],
    provenance: DOCUMENT_CHAT_PROVENANCE,
    strategy: "error",
    error: message,
    kind: "document_chat",
    ...(denseUnavailableReason ? { denseUnavailableReason } : {}),
  };
}
