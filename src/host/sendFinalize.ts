/**
 * Turn-end finalize: the assistant message's terminal write plus the
 * epoch-stamped history persist and the landing-keyed `saveEngineSession`
 * — the lifted body of `AiChatPage.tsx:2907-3046` (the `applyFinalize`
 * compose + the turn-end save block), re-expressed over the turn fence and
 * `createHistoryWriter`.
 *
 * The side effects stay INSIDE the setState updater on purpose: React still
 * applies queued updaters after a clear, so ownership is re-checked where
 * the queue is applied — the old code's own rule (AiChatPage:2956-2962).
 *
 * Not lifted: `turnEndSavePromiseRef` — the only reader was the
 * background-discard lifecycle this host does not mount (reported); the
 * 10 s fallback that keeps a wedged KV write from stranding the memory
 * extract's save gate is kept, because `armMemoryExtract` still needs it.
 */
import {
  miniappStripMakesKvNonReproducible,
} from "../engine/kvReproducibility";
import { markKvNonReproducible, saveEngineSession } from "../engine/LlamaService";
import { getActiveModelId } from "../engine/LlamaService";
import {
  normalizeModelEmittedTextForSave,
  normalizeThinkingTextForSave,
} from "../engine/modelEmittedText";
import { computeHistoryHashFromMessages } from "../engine/sessionPersistence";
import { parseMiniappFromText } from "../domain/askAssistant";
import { buildPersistableMessages } from "./historyMessages";
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";
import type { Message } from "./hostMessage";
import type { TurnFence, TurnToken } from "./turnGuards";

/**
 * Bounded fallback for the turn-end lifecycle: a KV write promise that never
 * settles must not hang the turn (it blocks memory extraction). A late
 * landing still writes the .kvs — the hold just does not wait forever.
 * Lifted from `AiChatPage.tsx:588-591`.
 */
export const HISTORY_WRITE_FALLBACK_MS = 10_000;

export interface FinalizeCtx {
  fence: TurnFence;
  token: TurnToken;
  assistantId: string;
  messagesRef: { current: Message[] };
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  persist: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => HistoryWriteTicket | null;
  getEpoch: () => number;
}

/**
 * Write the terminal state of the assistant message and persist. Returns
 * true when the finalize ran (the token still owned the turn at updater
 * time); a stale token changes nothing and skips the save.
 */
export function finalizeAssistantTurn(
  ctx: FinalizeCtx,
  captured: {
    modelEmittedText: string | undefined;
    modelEmittedSource: "parsed" | "raw" | undefined;
    thinkingText: string | undefined;
    failureReason?: string | undefined;
  },
  opts: {
    interrupted: boolean;
    /** Text for a failed turn whose stream never carried any. */
    fallbackText?: string;
    /** §2.8's failed row: mark the message failed and carry the engine's own
     *  reason (verbatim, possibly absent) — never a catalogued apology. */
    failure?: { reason?: string | undefined; thermal?: boolean };
    /** The engine's deferred extract release, adopted only through the save. */
    afterSessionSave?: () => void;
  },
): boolean {
  const { fence, token, assistantId, messagesRef, setMessages, persist, getEpoch } = ctx;
  let ran = false;
  setMessages((prev) =>
    fence.apply(token, prev, (state) => {
      ran = true;
      let miniappStripped = false;
      const next = state.map((message) => {
        if (message.id !== assistantId) return message;
        const emittedSave = normalizeModelEmittedTextForSave(
          "assistant",
          captured.modelEmittedText,
        );
        const thinkingSave = normalizeThinkingTextForSave("assistant", captured.thinkingText);
        const base: Message = {
          ...message,
          streaming: false,
          statusLabel: undefined,
          interrupted: opts.interrupted ? true : undefined,
          // §2.8: a failed turn says so — the failure reason is the engine's
          // own sentence (captured or thrown), trimmed; absent stays absent.
          failed: opts.failure ? true : undefined,
          failureReason: opts.failure?.reason?.trim() || undefined,
          failureThermal: opts.failure?.thermal ? true : undefined,
          ...(emittedSave !== undefined
            ? {
                modelEmittedText: emittedSave,
                // Same writer, same moment as the string (or no string,
                // no flag — see historyPersistable).
                emissionSource: captured.modelEmittedSource,
              }
            : {}),
          ...(thinkingSave !== undefined ? { thinkingText: thinkingSave } : {}),
        };
        if (opts.fallbackText !== undefined && base.text.trim().length === 0) {
          base.text = opts.fallbackText;
        }
        if (base.miniapp) return base;
        const extracted = parseMiniappFromText(base.text || "");
        // Only mark when a block was actually stripped (not every parse).
        if (miniappStripMakesKvNonReproducible(Boolean(extracted.miniapp))) {
          miniappStripped = true;
          return {
            ...base,
            text: extracted.text || base.text,
            miniapp: extracted.miniapp as Message["miniapp"],
          };
        }
        return base;
      });
      // Keep the ref in lockstep so flush paths cannot re-read a pre-finalize
      // streaming bubble during the pre-commit window.
      messagesRef.current = next;
      const epoch = getEpoch();
      const historyWrite = persist(next, { epoch });
      // A2: mark BEFORE save when miniapp JSON was stripped from text.
      if (miniappStripped) {
        markKvNonReproducible("miniapp_stripped");
      }
      const mid = getActiveModelId();
      const runAfterSave = opts.afterSessionSave;
      if (mid && historyWrite !== null && historyWrite.issued) {
        // settleHold is the ONLY runner for runAfterSave: a landing later
        // than the fallback cannot fire it a second time.
        let holdSettled = false;
        const settleHold = () => {
          if (holdSettled) return;
          holdSettled = true;
          if (fence.owns(token)) runAfterSave?.();
        };
        const holdFallback = setTimeout(settleHold, HISTORY_WRITE_FALLBACK_MS);
        // .kvs keyed off the write LANDING: hashing a list the store does
        // not hold makes boot mismatch and drop it.
        void historyWrite.landed.then((landed) => {
          clearTimeout(holdFallback);
          if (!landed) {
            settleHold();
            return;
          }
          const finalizedAtSave = next;
          const persistable = buildPersistableMessages(finalizedAtSave);
          void (async () => {
            try {
              await saveEngineSession(
                mid,
                computeHistoryHashFromMessages(persistable),
                persistable.length,
              );
              settleHold();
            } catch {
              settleHold();
            }
          })();
        });
      } else {
        // No engine save when the history write was refused (or there is no
        // model): hashing persistable while the store keeps more would
        // mismatch boot and drop a good .kvs — the extract still releases.
        if (fence.owns(token)) runAfterSave?.();
      }
      return next;
    }),
  );
  return ran;
}
