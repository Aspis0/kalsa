/**
 * Per-chat corpus singletons for the send window, lifted from
 * AppShell.tsx:636-826 — module-level Maps that survive remounts, plus the
 * hygiene filter, the warm-index sync, the per-chat reset and the history
 * validator. The compactor state machine inside a send reads these; the
 * conversation delete path calls `resetCompactorChat` (D2 row 19).
 *
 * Also the three per-process turn counters (AppShell:656-665): the monotonic
 * web_fetch allowlist sequence, the private-search latch and the
 * calendar-extract skip. They are shared between the tool executor and the
 * engine turn, which is why they live here rather than inside either one.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_CHAT_ID,
  compactorStorageKey,
  summaryStorageKey,
  toRetrievalUnits,
  type CompactorState,
  type HistoryRoleMessage,
} from "../context/compactor";
import { RetrieverIndex } from "../context/retriever";
import { readModelEmittedText } from "../engine/modelEmittedText";

export const compactorStateByChat = new Map<string, CompactorState>();
/** Last known history length per chat — clearChat detection (shrink). */
export const lastHistoryLenByChat = new Map<string, number>();
/** Force next-turn boundary rebuild after context_full (compaction ON). */
export const forceRebuildByChat = new Map<string, boolean>();
/**
 * Warm per-chat BM25 index over the compacted ("older") corpus.
 * Query-time digest hits this every turn (~3 ms); full rebuild only when the
 * boundary advances or state is reset. Cap avoids O(n) blow-up at huge chats.
 */
const digestIndexByChat = new Map<string, RetrieverIndex>();
/** Absolute history index covered by the warm index (older = [0, covered)). */
const digestIndexCoveredByChat = new Map<string, number>();
/** Message-unit count currently in the warm index (for cap / append bookkeeping). */
const digestIndexCorpusLenByChat = new Map<string, number>();
/**
 * Cap older-turns corpus fed to the warm RetrieverIndex.
 * Unbounded corpus → linear rebuild cost (~1.3s at 5000 turns desktop).
 */
export const MAX_DIGEST_CORPUS_MESSAGES = 400;
/**
 * Monotonic per-send turn id for the web_fetch allowlist (F5).
 * Keying on message text alone re-used the allowlist when the user re-sent the
 * same text; identical consecutive messages must get a fresh allowlist.
 */
export let fetchAllowlistTurnSeq = 0;
/** Turn seq that already ran calendar_agenda or device_info — refuse web_search. */
export let privateSearchLatchSeq = -1;
/** Turn seq that ran calendar_agenda — skip extractMemory for that turn. */
export let calendarExtractSkipSeq = -1;

export function bumpFetchAllowlistTurnSeq(): number {
  fetchAllowlistTurnSeq += 1;
  return fetchAllowlistTurnSeq;
}
export function latchPrivateSearch(seq: number): void {
  privateSearchLatchSeq = seq;
}
export function latchCalendarExtract(seq: number): void {
  calendarExtractSkipSeq = seq;
}
export function calendarExtractSkipped(seq: number): boolean {
  return calendarExtractSkipSeq === seq;
}
export function privateSearchLatched(seq: number): boolean {
  return privateSearchLatchSeq === seq;
}
export function currentTurnSeq(): number {
  return fetchAllowlistTurnSeq;
}

/**
 * Exclude error bubbles, kill-recovered partials, and abort-orphaned user turns
 * from digest/summary corpora. Engine history assembly is untouched.
 * - assistant text starting with "⚠️" → skip
 * - assistant with interrupted === true → skip (truncated kill-recovered fragment)
 * - user with no assistant reply immediately after → skip (except last message)
 */
export function filterCorpusHygiene(
  messages: HistoryRoleMessage[],
): HistoryRoleMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out: HistoryRoleMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.text.startsWith("⚠️")) continue;
    if (m.role === "assistant" && m.interrupted === true) continue;
    if (m.role === "user") {
      const isLast = i === messages.length - 1;
      if (!isLast) {
        const next = messages[i + 1];
        if (!next || next.role !== "assistant") continue;
      }
    }
    out.push(m);
  }
  return out;
}

export function resetDigestIndex(chatId: string): void {
  const id = chatId || DEFAULT_CHAT_ID;
  digestIndexByChat.delete(id);
  digestIndexCoveredByChat.delete(id);
  digestIndexCorpusLenByChat.delete(id);
}

/**
 * Keep the warm RetrieverIndex in sync with the older corpus under `boundary`.
 * - Same boundary as last sync → reuse index (query-time path).
 * - Boundary advanced (under or over cap) → append delta; dropOldestUnits when over cap.
 * - Boundary shrunk / missing / corpus-identity drift at same boundary → full rebuild.
 */
export function syncDigestIndex(
  chatId: string,
  history: HistoryRoleMessage[],
  boundary: number,
): RetrieverIndex {
  const id = chatId || DEFAULT_CHAT_ID;
  const b = Math.max(0, Math.min(boundary, history.length));
  const olderRaw = history.slice(0, b);
  const olderClean = filterCorpusHygiene(olderRaw);
  const corpus =
    olderClean.length > MAX_DIGEST_CORPUS_MESSAGES
      ? olderClean.slice(-MAX_DIGEST_CORPUS_MESSAGES)
      : olderClean;

  let idx = digestIndexByChat.get(id);
  const covered = digestIndexCoveredByChat.get(id) ?? -1;
  const corpusLen = digestIndexCorpusLenByChat.get(id) ?? 0;

  // Full rebuild only for genuine non-forward cases. A monotonically advancing
  // boundary past the cap is handled by append + dropOldestUnits below.
  const needsFullRebuild =
    !idx ||
    covered < 0 ||
    b < covered ||
    // Same boundary but corpus length drifted (hygiene identity change).
    (b === covered &&
      olderClean.length > MAX_DIGEST_CORPUS_MESSAGES &&
      corpus.length !== corpusLen);

  if (needsFullRebuild) {
    idx = new RetrieverIndex();
    if (corpus.length > 0) {
      // turnIndex = absolute history index of each kept message (approx after hygiene).
      const startIdx = Math.max(0, b - corpus.length);
      idx.append(toRetrievalUnits(corpus, startIdx));
    }
    digestIndexByChat.set(id, idx);
    digestIndexCoveredByChat.set(id, b);
    digestIndexCorpusLenByChat.set(id, corpus.length);
    return idx;
  }

  if (b > covered) {
    const delta = filterCorpusHygiene(history.slice(covered, b));
    if (delta.length > 0) {
      idx!.append(toRetrievalUnits(delta, covered));
      let newLen = corpusLen + delta.length;
      if (newLen > MAX_DIGEST_CORPUS_MESSAGES) {
        // Sliding window: drop oldest units so the index is at the cap.
        idx!.dropOldestUnits(newLen - MAX_DIGEST_CORPUS_MESSAGES);
        newLen = MAX_DIGEST_CORPUS_MESSAGES;
      }
      digestIndexCorpusLenByChat.set(id, newLen);
    }
    digestIndexCoveredByChat.set(id, b);
  }

  return idx!;
}

export async function resetCompactorChat(chatId: string): Promise<void> {
  const id = chatId || DEFAULT_CHAT_ID;
  compactorStateByChat.delete(id);
  lastHistoryLenByChat.delete(id);
  forceRebuildByChat.delete(id);
  resetDigestIndex(id);
  try {
    await AsyncStorage.multiRemove([
      compactorStorageKey(id),
      summaryStorageKey(id),
    ]);
  } catch {
    // best-effort
  }
}

/** The per-send compactor maps the window walk reads and writes. */
export function compactorMaps(): {
  state: Map<string, CompactorState>;
  lastLen: Map<string, number>;
  forceRebuild: Map<string, boolean>;
} {
  return {
    state: compactorStateByChat,
    lastLen: lastHistoryLenByChat,
    forceRebuild: forceRebuildByChat,
  };
}

export function validateHistoryMessages(
  history: unknown[] | undefined,
): HistoryRoleMessage[] {
  const out: HistoryRoleMessage[] = [];
  for (const m of history ?? []) {
    if (
      m &&
      typeof m === "object" &&
      typeof (m as { text?: unknown }).text === "string" &&
      ((m as { role?: unknown }).role === "user" ||
        (m as { role?: unknown }).role === "assistant")
    ) {
      const role = (m as { role: "user" | "assistant" }).role;
      const text = (m as { text: string }).text;
      const interrupted =
        (m as { interrupted?: unknown }).interrupted === true ? true : undefined;
      const edited =
        (m as { edited?: unknown }).edited === true ? true : undefined;
      const rawEmitted = (m as { modelEmittedText?: unknown }).modelEmittedText;
      // Load applies the save path's own rule (readModelEmittedText):
      // whitespace-only means absent, everything else is preserved
      // byte-for-byte. Trimming here destroyed leading whitespace the KV
      // holds, so the replay diverged at the emission's first token — and
      // every boot re-saved the trimmed value, so the bytes eroded one
      // boot at a time.
      const modelEmittedText = readModelEmittedText(role, rawEmitted);
      // Provenance travels WITH the string: absent (or corrupt) stays absent
      // and the renderer falls back to its syntactic predicate.
      const rawSource = (m as { emissionSource?: unknown }).emissionSource;
      const emissionSource =
        rawSource === "parsed" || rawSource === "raw" ? rawSource : undefined;
      const rec: HistoryRoleMessage & { edited?: boolean } = { role, text };
      if (interrupted !== undefined) rec.interrupted = interrupted;
      if (edited !== undefined) rec.edited = edited;
      if (modelEmittedText !== undefined) {
        rec.modelEmittedText = modelEmittedText;
        if (emissionSource !== undefined) rec.emissionSource = emissionSource;
      }
      out.push(rec);
    }
  }
  return out;
}
