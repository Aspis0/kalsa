/**
 * Persistable projection for chat history hashing and AsyncStorage.
 * Save and load must stringify the same shape or restore deletes a good .kvs.
 */
import {
  normalizeModelEmittedTextForSave,
  normalizeThinkingTextForSave,
} from "./modelEmittedText";

function mapPersistableAttachments(raw: unknown): unknown {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((a) => {
    if (!a || typeof a !== "object" || Array.isArray(a)) return a;
    const rec = a as Record<string, unknown>;
    const next: Record<string, unknown> = {
      id: rec.id,
      kind: rec.kind,
      name: rec.name,
      uri: "",
    };
    if (typeof rec.pageCount === "number" && rec.pageCount > 0) {
      next.pageCount = rec.pageCount;
    }
    if (typeof rec.libraryDocId === "string" && rec.libraryDocId.length > 0) {
      next.libraryDocId = rec.libraryDocId.slice(0, 120);
    }
    return next;
  });
}

/**
 * Strip live-only fields so boot JSON and in-memory messages hash alike.
 * `streaming` / `statusLabel` / `statusHistory` never persist.
 */
export function toPersistableHistoryMessages(
  messages: unknown,
  opts?: { allowStreamingPartial?: boolean },
): unknown[] {
  if (!Array.isArray(messages)) return [];
  const allowStreamingPartial = opts?.allowStreamingPartial === true;
  const out: unknown[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const rec = message as Record<string, unknown>;
    if (rec.streaming) {
      if (!allowStreamingPartial) continue;
      if (typeof rec.text !== "string" || rec.text.trim().length === 0) continue;
    }
    const next: Record<string, unknown> = { ...rec };
    delete next.streaming;
    delete next.statusLabel;
    delete next.statusHistory;
    if (rec.streaming && allowStreamingPartial) {
      next.interrupted = true;
    }
    const attachments = mapPersistableAttachments(rec.attachments);
    if (attachments !== undefined) next.attachments = attachments;
    const emitted = normalizeModelEmittedTextForSave(
      typeof rec.role === "string" ? rec.role : "",
      rec.modelEmittedText,
    );
    if (emitted !== undefined) {
      next.modelEmittedText = emitted;
      // The provenance flag only means something WITH its string: valid value
      // travels, everything else (absent string, corrupt value) is dropped so
      // the renderer falls back to the syntactic predicate.
      if (rec.emissionSource === "parsed" || rec.emissionSource === "raw") {
        next.emissionSource = rec.emissionSource;
      } else {
        delete next.emissionSource;
      }
    } else {
      delete next.modelEmittedText;
      delete next.emissionSource;
    }
    const thinking = normalizeThinkingTextForSave(
      typeof rec.role === "string" ? rec.role : "",
      rec.thinkingText,
    );
    if (thinking !== undefined) next.thinkingText = thinking;
    else delete next.thinkingText;
    out.push(next);
  }
  return out;
}
