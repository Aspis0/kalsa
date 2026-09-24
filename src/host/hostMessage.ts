/**
 * Host-owned chat message and stream payload types. History serialization
 * preserves the field contract defined by `historyPersistable.ts`.
 */
import type { EmissionSource } from "../engine/modelEmittedText";

export type MessageSource = {
  title: string;
  /** Landing URL from web_search (optional for older history). */
  url?: string;
  authors?: string;
  doi?: string;
  /** Search provider id that produced this source. */
  provider?: string;
};

export type ResultImage = { id: string; label: string; url: string; artifactType?: string };
export type ResultDownload = { id: string; label: string; url: string; artifactType?: string };
export type ChatCta = {
  artifactType?: string | null;
  contrastId?: string | null;
  id?: string;
  kind: "output" | "output_picker" | "run_monitor_recovery";
  label: string;
  outputId?: string | null;
  target?: string | null;
};

/** Attachment data staged by the composer and carried with the send. */
export type LocalAttachment = {
  id: string;
  kind: "image" | "pdf" | "document";
  name: string;
  uri: string;
  pages?: string[];
  pageCount?: number;
  /** Library document id when kind === "document". */
  libraryDocId?: string;
};

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
   * completed turn; "raw" = accumulation of an interrupted turn (seed is
   * prompt bytes, never payload). Absent = unknown provenance (pre-flag
   * history) — the renderer falls back to its syntactic predicate.
   */
  emissionSource?: EmissionSource;
  /**
   * Reasoning the model emitted inside its think block (assistant only).
   * UI-only: rendered as the cloud above the answer. Prompt replay never
   * uses this — modelEmittedText already carries the raw think span.
   */
  thinkingText?: string;
  streaming?: boolean;
  /** Terminal marker: generation was interrupted mid-stream (partial text kept). */
  interrupted?: boolean;
  /**
   * Terminal marker: the turn FAILED (§2.8's failed row) instead of finishing.
   * Without it a crashed or refused turn draws exactly like a completed one —
   * the lie `docs/PARITY-STATUS.md` gap 2 names. Set only by the send path's
   * finalize; persisted and restored, so the mark survives a reopen.
   */
  failed?: boolean;
  /**
   * The engine's own reason for `failed`, verbatim after trimming. Absent when
   * the engine gave none — §2.8 forbids a generic apology in this slot, so an
   * empty reason renders the catalogued line, never a fabricated sentence.
   */
  failureReason?: string;
  /** The device refused the turn (thermal), not the engine: the mapper sends
   *  it to §2.8's thermal row instead of the failed row. */
  failureThermal?: boolean;
  /** True when the user edited this message text (edit-then-regen flow). */
  edited?: boolean;
  statusLabel?: string;
  statusHistory?: string[];
  sources?: MessageSource[];
  miniapp?: { kind: string; title: string; blocks: any[] };
  attachments?: LocalAttachment[];
  // RNA-seq job context: result image/download links delivered alongside the
  // assistant reply.
  images?: ResultImage[];
  downloads?: ResultDownload[];
  ctas?: ChatCta[];
  createdAt: number;
};

/**
 * Module counter for message ids. Avoids Date.now() collisions when two ids
 * land in one synchronous block; the seed restarts per process, as the old
 * screen did.
 */
let messageIdCounter = Math.floor((Date.now() % 1_000_000_000) / 7);
export function nextMsgId(prefix: string): string {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}
