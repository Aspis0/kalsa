import type { DocumentChatToolDef } from "./documentChatTypes";

export const DOCUMENT_CHAT_TOOL: DocumentChatToolDef = {
  type: "function",
  function: {
    name: "document_chat",
    description:
      "Query a local PDF or TXT document from the user's library. " +
      "Pass a specific question as query. Optionally pass docId of a library document " +
      "(or omit when only one document is in the library / one is attached). " +
      "Returns relevant passages with page citations, or the full text for small documents. " +
      "Scanned PDFs with no text layer return a vision-fallback marker.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What you want to find in the document — a specific question or topic.",
        },
        docId: {
          type: "string",
          description:
            "Library document id. Optional when the library has exactly one document.",
        },
      },
      required: ["query"],
    },
  },
};
