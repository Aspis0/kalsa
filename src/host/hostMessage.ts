/**
 * The chat message, lifted verbatim from AiChatPage.tsx:240-286.
 *
 * The old screen keeps its own copy (it must stay runnable as the
 * controller); this is the same shape so `sanitizeHistoryMessages`,
 * `buildPersistableMessages` and `historyPersistable.ts` round-trip the
 * identical field set — the hash contract of D2 row 2 depends on it.
 * The supporting types are imported type-only from the controller: no
 * runtime edge, no edit.
 */
import type {
  ChatCta,
  LocalAttachment,
  MessageSource,
  ResultDownload,
  ResultImage,
} from "../screens/AiChatPage";
import type { EmissionSource } from "../engine/modelEmittedText";

export type { ChatCta, LocalAttachment, MessageSource, ResultDownload, ResultImage };

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /**
   * Text the model actually emitted (assistant only). UI renders `text`
   * (cleaned); prompt assembly replays this when present so the KV prefix matches.
   */
  modelEmittedText?: string;
  /**
   * Provenance of modelEmittedText — the MECHANISM that produced the string,
   * set by the same writer that set the string. "parsed" = native parse of a
   * completed turn (seed tag inside content); "raw" = raw accumulation of an
   * interrupted turn (seed is prompt bytes, never payload). Absent = unknown
   * provenance (pre-flag history) — the renderer falls back to its syntactic
   * predicate, so old messages stay valid.
   */
  emissionSource?: EmissionSource;
  /**
   * Reasoning the model emitted inside its think block (assistant only).
   * UI-only: rendered as the cloud above the answer. Prompt replay
   * never uses this — modelEmittedText already carries the raw think span.
   */
  thinkingText?: string;
  streaming?: boolean;
  /** Terminal marker: generation was interrupted mid-stream (partial text kept). */
  interrupted?: boolean;
  /**
   * Terminal marker: the turn FAILED (§2.8's failed row) instead of finishing.
   * Without it a crashed or refused turn draws exactly like a completed one —
   * the lie `docs/PARITY-STATUS.md` gap 2 names. Set only by the send path's
   * finalize; persisted (it rides the spread in `historyPersistable.ts`) and
   * restored by `sanitizeHistoryMessages`, so the mark survives a reopen.
   */
  failed?: boolean;
  /**
   * The engine's own reason for `failed`, verbatim after trimming. Absent when
   * the engine gave none — §2.8 forbids a generic apology in this slot, so an
   * empty reason renders the catalogued "Stopped by an error" line and never
   * a fabricated sentence.
   */
  failureReason?: string;
  /** The device refused the turn (thermal), not the engine: the mapper sends
   *  it to §2.8's thermal row instead of the failed row. */
  failureThermal?: boolean;
  /** True when the user edited this message text (edit-then-regen flow). */
  edited?: boolean;
  // Feature 1: status history
  statusLabel?: string;
  statusHistory?: string[];
  sources?: MessageSource[];
  // Feature 2: miniapp
  miniapp?: { kind: string; title: string; blocks: any[] };
  // Attachments on user messages.
  attachments?: LocalAttachment[];
  // RNA-seq job context: result image/download links delivered alongside the
  // assistant reply.
  images?: ResultImage[];
  downloads?: ResultDownload[];
  ctas?: ChatCta[];
  createdAt: number;
};

/**
 * Module counter for message ids — lifted from AiChatPage.tsx:559-565.
 * Avoids Date.now() collisions when two ids land in one synchronous block;
 * the seed restarts per process, which is what the old screen did too.
 */
let messageIdCounter = Math.floor((Date.now() % 1_000_000_000) / 7);
export function nextMsgId(prefix: string): string {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}
