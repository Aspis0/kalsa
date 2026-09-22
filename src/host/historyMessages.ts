/**
 * The history record shape: what is written to AsyncStorage and what comes
 * back out of it.
 *
 * `buildPersistableMessages` is lifted from AiChatPage.tsx:576-587 and
 * `sanitizeHistoryMessages` from AiChatPage.tsx:656-818, verbatim except
 * for the docstring language (English, per the repo rule). The two carry
 * the parity document's rules:
 *
 * - SOURCES PERSIST (AiChatPage:713-731): the source strip is rebuilt from
 *   the raw record, bounded and validated field by field.
 * - STATUS IS VOLATILE (AiChatPage:709-713): `statusLabel` /
 *   `statusHistory` are intentionally dropped on restore, and a live
 *   `streaming` flag is never restored — no eternal spinners after a kill.
 * - `interrupted` is restored only with non-empty text (a corrupt payload
 *   cannot render a floating marker);
 * - `failed` / `failureReason` / `failureThermal` (§2.8's failed row) restore
 *   on the same rule: the marker only with non-empty text, the engine's own
 *   reason verbatim (clipped like any text) and only beside a marker — a
 *   reason with no failure to explain is corrupt data, not a line to draw.
 *
 * The projection goes through `toPersistableHistoryMessages`
 * (`src/engine/historyPersistable.ts`, untouched): the persisted field set
 * IS the hash contract of D2 row 2, and both directions must agree with it.
 */
import { getStrings, type Locale } from "../i18n";
import { normalizeMiniapp, parseMiniappFromText } from "../domain/askAssistant";
import {
  readModelEmittedText,
  readThinkingText,
} from "../engine/modelEmittedText";
import { toPersistableHistoryMessages } from "../engine/historyPersistable";
import type { ChatCta, LocalAttachment, Message } from "./hostMessage";

/**
 * Build the AsyncStorage payload for chat history.
 * Normal path skips live streaming messages (no token-churn writes).
 * With allowStreamingPartial, in-flight assistant bubbles with non-empty text
 * are written as interrupted partials so a process kill can still restore them.
 */
export function buildPersistableMessages(
  messagesSnapshot: Message[],
  opts?: { allowStreamingPartial?: boolean },
): Message[] {
  return toPersistableHistoryMessages(messagesSnapshot, opts) as Message[];
}

/** Validate every field (even nested) of a persisted history payload: a
 *  corrupt record is skipped or clipped, never thrown on. */
export function sanitizeHistoryMessages(raw: unknown, locale: Locale): Message[] {
  if (!Array.isArray(raw)) return [];
  const strings = getStrings(locale);
  const result: Message[] = [];
  const MAX_TEXT = 100_000;
  const MAX_ITEMS = 100;
  // Dedup id: sessions without a unique seed may have persisted duplicate ids
  // (the same counter restarted from zero) -> duplicate React keys.
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.text !== "string") continue;
    let messageId = record.id;
    if (seenIds.has(messageId)) {
      messageId = `${messageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    seenIds.add(messageId);
    const message: Message = {
      id: messageId,
      role: record.role,
      text: record.text.slice(0, MAX_TEXT),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    };
    // interrupted is terminal (partial kept after kill) — restore so the UI marker shows.
    // Only with non-empty text so a corrupt payload cannot render a floating marker.
    // Transient `streaming` is never restored (no eternal spinners).
    if (record.interrupted === true && message.text.trim().length > 0) {
      message.interrupted = true;
    }
    // §2.8's failed row survives a reopen (the fields ride the persistable
    // spread, so save and load round-trip the same shape). The reason is the
    // engine's own words as data — never a catalogue line — and `failed` alone
    // draws the reasonless honest line when no reason was stored.
    if (record.failed === true && message.text.trim().length > 0) {
      message.failed = true;
      if (typeof record.failureReason === "string" && record.failureReason.trim()) {
        message.failureReason = record.failureReason.trim().slice(0, MAX_TEXT);
      }
      if (record.failureThermal === true) {
        message.failureThermal = true;
      }
    }
    if (record.edited === true) {
      message.edited = true;
    }
    // Model-emitted text (assistant only) for prompt replay / KV prefix match.
    const emitted = readModelEmittedText(record.role, record.modelEmittedText);
    if (emitted !== undefined) {
      // Latent erosion: this slice cuts the emission while emissionSource
      // rides along unchanged, and the next save makes the cut permanent —
      // the same class the load-path fix removed for trim, left here for
      // length (no reachable input reaches it at today's n_ctx).
      message.modelEmittedText = emitted.slice(0, MAX_TEXT);
      // Propagate the provenance flag; a persisted value outside the union
      // (corrupt payload) falls back to unknown → syntactic predicate.
      if (record.emissionSource === "parsed" || record.emissionSource === "raw") {
        message.emissionSource = record.emissionSource;
      }
    }
    // Model reasoning (assistant only) for the collapsed block above the answer.
    const thinking = readThinkingText(record.role, record.thinkingText);
    if (thinking !== undefined) {
      message.thinkingText = thinking.slice(0, MAX_TEXT);
    }
    // Transient UI only — never restore live status strips after kill/reload
    // (orphan "Writing / Reading document…" after a finished turn — Jelly MED-5).
    // statusLabel / statusHistory are intentionally dropped on restore.
    if (Array.isArray(record.sources) && record.sources.length <= MAX_ITEMS) {
      message.sources = record.sources
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .slice(0, MAX_ITEMS)
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title:
            (typeof s.title === "string" && s.title.trim() ? s.title : "" ) ||
            (typeof s.url === "string" ? s.url : "") ||
            (typeof s.host === "string" ? s.host : "") ||
            strings.common.source,
          ...(typeof s.authors === "string" ? { authors: s.authors.slice(0, 300) } : {}),
          ...(typeof s.doi === "string" ? { doi: s.doi.slice(0, 300) } : {}),
          ...(typeof s.url === "string" ? { url: s.url.slice(0, 2000) } : {}),
          ...(typeof s.provider === "string" ? { provider: s.provider.slice(0, 40) } : {}),
        }));
    }
    // Always normalize miniapp through the domain layer so null/string blocks
    // and missing answerIndex never crash the renderer on history reload.
    if (record.miniapp && typeof record.miniapp === "object" && !Array.isArray(record.miniapp)) {
      const normalized = normalizeMiniapp(record.miniapp);
      if (normalized) {
        message.miniapp = normalized as Message["miniapp"];
      }
      // If normalize fails, leave miniapp unset (text-only) and try text migration below.
    }
    // Migration: older history may have miniapp JSON only inside assistant text,
    // or a corrupt miniapp field that failed normalize above.
    if (record.role === "assistant" && !message.miniapp) {
      const extracted = parseMiniappFromText(message.text);
      if (extracted.miniapp) {
        message.text = (extracted.text || message.text).slice(0, MAX_TEXT);
        message.miniapp = extracted.miniapp as Message["miniapp"];
      }
    }
    if (Array.isArray(record.attachments) && record.attachments.length <= MAX_ITEMS) {
      message.attachments = record.attachments
        .filter(
          (a): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a),
        )
        .slice(0, MAX_ITEMS)
        .map((a) => ({
          id: typeof a.id === "string" ? a.id : `att-${Date.now()}`,
          kind:
            a.kind === "pdf" || a.kind === "image" || a.kind === "document"
              ? (a.kind as LocalAttachment["kind"])
              : "image",
          name: typeof a.name === "string" ? a.name.slice(0, 300) : strings.common.attachment,
          // URIs are temporary caches: never persisted (unavailable on reload).
          uri: "",
          ...(typeof a.pageCount === "number" && a.pageCount > 0
            ? { pageCount: Math.min(a.pageCount, 10) }
            : {}),
          ...(typeof a.libraryDocId === "string" && a.libraryDocId.length > 0
            ? { libraryDocId: a.libraryDocId.slice(0, 120) }
            : {}),
        }));
    }
    if (Array.isArray(record.images) && record.images.length <= MAX_ITEMS) {
      message.images = record.images
        .filter(
          (i): i is Record<string, unknown> =>
            !!i && typeof i === "object" && !Array.isArray(i) && typeof i.url === "string",
        )
        .slice(0, MAX_ITEMS)
        .map((i) => ({
          id: typeof i.id === "string" ? i.id : `img-${Date.now()}`,
          label: typeof i.label === "string" ? i.label.slice(0, 300) : strings.common.image,
          url: (i.url as string).slice(0, 2000),
          ...(typeof i.artifactType === "string" ? { artifactType: i.artifactType } : {}),
        }));
    }
    if (Array.isArray(record.downloads) && record.downloads.length <= MAX_ITEMS) {
      message.downloads = record.downloads
        .filter(
          (d): d is Record<string, unknown> =>
            !!d && typeof d === "object" && !Array.isArray(d) && typeof d.url === "string",
        )
        .slice(0, MAX_ITEMS)
        .map((d) => ({
          id: typeof d.id === "string" ? d.id : `dl-${Date.now()}`,
          label: typeof d.label === "string" ? d.label.slice(0, 300) : strings.common.download,
          url: (d.url as string).slice(0, 2000),
          ...(typeof d.artifactType === "string" ? { artifactType: d.artifactType } : {}),
        }));
    }
    if (Array.isArray(record.ctas) && record.ctas.length <= MAX_ITEMS) {
      message.ctas = record.ctas
        .filter(
          (c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c),
        )
        .slice(0, MAX_ITEMS)
        .map((c) => ({
          kind: (typeof c.kind === "string" ? c.kind : "output") as ChatCta["kind"],
          label: (c.label as string).slice(0, 300),
          ...(typeof c.id === "string" ? { id: c.id } : {}),
          ...(typeof c.outputId === "string" ? { outputId: c.outputId } : {}),
          ...(typeof c.target === "string" ? { target: c.target } : {}),
        }));
    }
    result.push(message);
  }
  return result;
}
