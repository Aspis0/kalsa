import type {
  ActiveDocumentAttachment,
  SelectDocResult,
} from "./documentChatTypes";
import type { LibraryDoc } from "./DocumentLibrary";

/** Pick the library document for a document_chat call. */
export function selectDoc(
  docs: LibraryDoc[],
  docId?: string,
  activeAttachment?: ActiveDocumentAttachment | null,
): SelectDocResult | null {
  if (!docs.length) return null;
  if (docId) {
    const exact = docs.find((d) => d.id === docId);
    if (exact) return { doc: exact, requestedIdNotFound: false };
    const requested = normalizeDocumentLabel(docId);
    if (requested) {
      const named = docs.find((d) => documentLabels(d).some((label) => label === requested));
      if (named) return { doc: named, requestedIdNotFound: false };
    }
    // Explicit id matched nothing: single-doc library → use it, flagged;
    // 2+ docs → null (caller lists documents). NEVER the attachment fallback.
    if (docs.length === 1) {
      const only = docs[0];
      return only ? { doc: only, requestedIdNotFound: true } : null;
    }
    return null;
  }
  if (docs.length === 1) {
    const only = docs[0];
    return only ? { doc: only, requestedIdNotFound: false } : null;
  }
  if (activeAttachment) {
    const activeId = activeAttachment.libraryDocId;
    if (typeof activeId === "string" && activeId.length > 0) {
      const activeExact = docs.find(
        (d) => d.id === activeId || d.sourceId === activeId,
      );
      if (activeExact) return { doc: activeExact, requestedIdNotFound: false };
    }
    const attachmentLabels = [activeAttachment.name]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(normalizeDocumentLabel)
      .filter((value) => value.length > 0);
    const active = docs.find((d) =>
      documentLabels(d).some((label) => attachmentLabels.includes(label)),
    );
    if (active) return { doc: active, requestedIdNotFound: false };
  }
  return null;
}

function normalizeDocumentLabel(value: string): string {
  const base = value.trim().split(/[\\/]/).pop() ?? "";
  return base
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function documentLabels(doc: LibraryDoc): string[] {
  return [doc.name, doc.fileUri, doc.sourceId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeDocumentLabel)
    .filter((value) => value.length > 0);
}

export function formatDocList(docs: LibraryDoc[]): string {
  return docs
    .map((doc) => `${doc.id} — ${doc.name || "Untitled"}`)
    .join("; ");
}
