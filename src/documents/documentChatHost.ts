import { summarizePdfExtraction } from "./extractionScope";
import type {
  ActiveDocumentAttachment,
  DocumentChatHost,
  LoadedDocumentResult,
} from "./documentChatTypes";
import type { LibraryDoc } from "./DocumentLibrary";

export function safeActiveAttachment(
  host: DocumentChatHost,
): ActiveDocumentAttachment | null {
  try {
    const attachment = host.getActiveAttachment?.();
    if (!attachment || typeof attachment !== "object") return null;
    return attachment;
  } catch {
    return null;
  }
}

export function safeLibraryDocs(host: DocumentChatHost): LibraryDoc[] {
  try {
    const docs = host.getLibraryDocs();
    return Array.isArray(docs) ? docs : [];
  } catch {
    return [];
  }
}

export function getHostModelId(host: DocumentChatHost): string {
  return typeof host.getModelId === "function" ? host.getModelId() ?? "" : "";
}

export async function loadDocText(
  host: DocumentChatHost,
  doc: LibraryDoc,
  signal?: AbortSignal,
): Promise<LoadedDocumentResult> {
  try {
    if (signal?.aborted) throw new Error("document_chat aborted");
    if (doc.kind === "txt") {
      const raw = await host.readTxt(doc, { signal });
      const text = typeof raw === "string" ? raw : "";
      const trimmed = text.trim();
      if (!trimmed) return { kind: "ok", fullText: "", docCount: 0, pages: [] };
      return {
        kind: "ok",
        fullText: trimmed,
        docCount: 1,
        pages: [{ docId: doc.sourceId, title: doc.name, text: trimmed }],
      };
    }

    const extracted = await host.requestPdfText(doc, { signal });
    const scope = summarizePdfExtraction(extracted);
    const pages = scope.docs
      .filter((d) => d && typeof d.text === "string" && d.text.trim().length > 0)
      .map((d) => ({
        docId: typeof d.docId === "string" ? d.docId : doc.sourceId,
        title: d.title,
        text: d.text,
      }));
    return {
      kind: "ok",
      fullText: scope.fullText,
      docCount: scope.docCount,
      pageCount: scope.pageCount,
      processedPageCount: scope.processedPageCount,
      truncated: scope.truncated,
      pages,
    };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "busy") return { kind: "error", message: "PDF text extraction is busy" };
    if (code === "timeout") {
      return { kind: "error", message: "PDF text extraction timed out" };
    }
    if (code === "no_host") {
      return { kind: "error", message: "PDF text extractor host is not mounted" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message: message || "Failed to load document text" };
  }
}
