import type { DocRetrieverIndex, RetrievedPassage } from "../context/retrievalLoop";
import type { PdfRetrievalDocsResult } from "../util/pdfText";
import type { LibraryDoc } from "./DocumentLibrary";
import type { SemanticVectorIndex } from "./semanticIndex";

/** Structural match for EngineTool (avoid importing LlamaService in the harness). */
export type DocumentChatToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type DenseUnavailableReason =
  | "cap"
  | "capped"
  | "corrupt"
  | "no_embedder"
  /** Embedder native op abandoned after chat-init release timeout (round 6). */
  | "hung"
  /** PDF/TXT extraction failed (round-8 FIX 2 — maps to documents.extraction.*). */
  | "timeout"
  | "renderer_error"
  | "fs_error"
  | null;

export type DocumentChatToolResult = {
  text: string;
  passages: RetrievedPassage[];
  provenance: string;
  strategy:
    | "full_context"
    | "retrieve"
    | "hybrid"
    | "bm25_only"
    | "vision_fallback"
    | "error";
  error?: string;
  kind?: "document_chat";
  denseUnavailableReason?: DenseUnavailableReason;
};

export type ActiveDocumentAttachment = {
  libraryDocId?: string;
  name?: string;
};

export type DocumentChatHost = {
  getLibraryDocs(): LibraryDoc[];
  getActiveAttachment?(): ActiveDocumentAttachment | null;
  requestPdfText(
    doc: LibraryDoc,
    opts?: { signal?: AbortSignal },
  ): Promise<PdfRetrievalDocsResult>;
  readTxt(doc: LibraryDoc, opts?: { signal?: AbortSignal }): Promise<string>;
  getCtxTokens(): number;
  getModelId?(): string | null;
  getIndexFor(docId: string): DocRetrieverIndex | null;
  setIndexFor?(docId: string, index: DocRetrieverIndex): void;
  getSemanticIndexFor?(docId: string): SemanticVectorIndex | null;
  loadSemanticIndexFor?(docId: string): Promise<SemanticVectorIndex | null>;
  getDenseUnavailableReason?(docId: string): DenseUnavailableReason;
  isEmbedderDownloaded?(): boolean;
  embedQuery?(text: string, signal?: AbortSignal): Promise<Float32Array | null>;
};

export type LoadedDocument = {
  fullText: string;
  docCount: number;
  pageCount?: number;
  processedPageCount?: number;
  truncated?: boolean;
  pages: Array<{ docId: string; title?: string; text: string }>;
};

export type LoadedDocumentResult =
  | ({ kind: "ok" } & LoadedDocument)
  | { kind: "error"; message: string };

export type DocumentChatExecute = (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{
  passages?: RetrievedPassage[];
  strategy?: string;
  error?: string;
  text?: string;
}>;

export type LibraryRetrieveResult = {
  passages: RetrievedPassage[];
  failed: number;
  aborted: boolean;
  deadlineHit?: boolean;
};

export type SelectDocResult = {
  doc: LibraryDoc;
  requestedIdNotFound: boolean;
};

export type HybridAttempt =
  | {
      strategy: "hybrid";
      passages: RetrievedPassage[];
      denseUnavailableReason: null | "capped";
    }
  | {
      strategy: "bm25_only";
      passages: null;
      denseUnavailableReason: Exclude<DenseUnavailableReason, null>;
    };
