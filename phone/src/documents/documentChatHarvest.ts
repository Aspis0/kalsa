import type { RetrievedPassage } from "../context/retrievalLoop";
import type { LibraryDoc } from "./DocumentLibrary";
import type {
  DocumentChatExecute,
  LibraryRetrieveResult,
} from "./documentChatTypes";

const FULL_CONTEXT_PASSAGE_CAP_CHARS = 1600;

export async function retrieveLibraryPassages(
  execute: DocumentChatExecute,
  query: string,
  docs: LibraryDoc[],
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<LibraryRetrieveResult> {
  const passages: RetrievedPassage[] = [];
  const seen = new Set<string>();
  let failed = 0;
  const list = Array.isArray(docs) ? docs : [];
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return { passages, failed, aborted: Boolean(signal?.aborted) };

  for (const doc of list) {
    if (signal?.aborted) return { passages, failed, aborted: true };
    if (deadlineAt && Date.now() >= deadlineAt) {
      return { passages, failed, aborted: false, deadlineHit: true };
    }
    if (!doc || typeof doc.id !== "string" || !doc.id) continue;

    let result: Awaited<ReturnType<DocumentChatExecute>>;
    try {
      result = await execute("document_chat", { query: q, docId: doc.id }, signal);
    } catch {
      failed += 1;
      continue;
    }
    if (signal?.aborted) return { passages, failed, aborted: true };
    if (!result || result.strategy === "error") {
      failed += 1;
      continue;
    }

    const before = passages.length;
    const rows = Array.isArray(result.passages) ? result.passages : [];
    for (const p of rows) {
      if (!p || typeof p.chunkId !== "string") continue;
      const key = `${p.docId}\0${p.chunkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      passages.push(p);
    }
    harvestFullContextPassage(result, doc, passages, seen);

    const added = passages.length - before;
    if (
      result.strategy === "vision_fallback" ||
      (result.strategy === "full_context" && added === 0)
    ) {
      failed += 1;
    }
  }
  return { passages, failed, aborted: Boolean(signal?.aborted) };
}

function harvestFullContextPassage(
  result: Awaited<ReturnType<DocumentChatExecute>>,
  doc: LibraryDoc,
  passages: RetrievedPassage[],
  seen: Set<string>,
): void {
  if (result.strategy !== "full_context") return;
  const body = typeof result.text === "string" ? result.text.trim() : "";
  const clean = stripFullContextFraming(body);
  if (!clean) return;
  const docId = typeof doc.sourceId === "string" && doc.sourceId ? doc.sourceId : doc.id;
  const key = `${docId}\0${doc.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  passages.push({
    docId,
    chunkId: doc.id,
    granularity: "paragraph",
    text:
      clean.length > FULL_CONTEXT_PASSAGE_CAP_CHARS
        ? clean.slice(0, FULL_CONTEXT_PASSAGE_CAP_CHARS)
        : clean,
    score: 1,
    round: 0,
    rankInRound: 1,
  });
}

function stripFullContextFraming(body: string): string {
  return body
    .replace(/^[^\n]*\n\n/, "")
    .replace(/\n\nAnswer in the language of the user's question [^\n]*$/, "")
    .trim();
}
