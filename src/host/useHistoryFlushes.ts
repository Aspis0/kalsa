/**
 * The three write-while-alive effects of the history path: a 400 ms debounce,
 * a 10 s streaming safety net, and the AppState background flush with the
 * turn-end-adjacent session save keyed off the write LANDING.
 *
 * Adaptations (reported): the epoch is the writer's (stamped at schedule);
 * the voice-capture/TTS background branch left with the voice system this
 * host does not mount; the background clean-save block now goes through
 * `writer.persist` instead of calling the guard directly — same guard, same
 * landing-keyed `saveEngineSession`.
 */
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { computeHistoryHashFromMessages } from "../engine/sessionPersistence";
import {
  getActiveModelId,
  invalidateEngineSession,
  saveEngineSession,
} from "../engine/engineBackend";
import { buildPersistableMessages } from "./historyMessages";
import type { HistoryWriter } from "./historyWrite";
import type { Message } from "./hostMessage";
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";

export function useHistoryFlushes(params: {
  messages: Message[];
  messagesRef: { current: Message[] };
  historyLoaded: boolean;
  sendingRef: { current: boolean };
  writer: HistoryWriter<Message>;
  persistActiveMessages: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => HistoryWriteTicket | null;
  notifyConversationTouched: (msgs: Message[]) => void;
}): void {
  const {
    messages,
    messagesRef,
    historyLoaded,
    sendingRef,
    writer,
    persistActiveMessages,
    notifyConversationTouched,
  } = params;
  /** Throttle for mid-stream safety-net persists (at most once / 10s). */
  const lastPartialPersistAtRef = useRef(0);
  // Debounced normal path: skip while any turn is streaming so the 400ms quiet
  // gap cannot clobber a throttled/AppState partial (drops streaming messages).
  // Partials are owned exclusively by the 10s throttle + AppState/unmount flushes;
  // on completion (streaming cleared) this path resumes and overwrites the partial.
  useEffect(() => {
    if (!historyLoaded || !messages.length) return;
    if (messages.some((m) => m.streaming)) return;
    // Stamp epoch at SCHEDULE time so a clearChat during the 400ms window drops.
    const epoch = writer.epoch();
    const timer = setTimeout(() => {
      if (writer.epoch() !== epoch) return;
      // Attachments[].uri/pages are stripped inside buildPersistableMessages.
      persistActiveMessages(messages, { epoch });
    }, 400);
    return () => clearTimeout(timer);
  }, [historyLoaded, messages, persistActiveMessages]);
  // Safety net while streaming: at most one partial persist every 10s.
  useEffect(() => {
    const streamingWithText = messages.some(
      (m) => m.streaming && typeof m.text === "string" && m.text.trim().length > 0,
    );
    if (!streamingWithText) {
      lastPartialPersistAtRef.current = 0;
      return;
    }
    if (!historyLoaded) return;
    const now = Date.now();
    if (
      lastPartialPersistAtRef.current !== 0 &&
      now - lastPartialPersistAtRef.current < 10_000
    ) {
      return;
    }
    lastPartialPersistAtRef.current = now;
    const epoch = writer.epoch();
    persistActiveMessages(messages, { allowStreamingPartial: true, epoch });
  }, [historyLoaded, messages, persistActiveMessages]);
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        const snap = messagesRef.current;
        // Capture epoch at flush time; drop if clearChat lands before write.
        const epoch = writer.epoch();
        if (
          snap.some(
            (m) => m.streaming && typeof m.text === "string" && m.text.trim().length > 0,
          )
        ) {
          persistActiveMessages(snap, {
            allowStreamingPartial: true,
            epoch,
          });
        }
        // KV save + clean history overwrite only on true background + idle.
        // While sending, keep the allowStreamingPartial payload above — a
        // clean buildPersistableMessages would drop the partial.
        if (next === "background" && !sendingRef.current) {
          const modelId = getActiveModelId();
          if (modelId) {
            const clean = buildPersistableMessages(snap);
            if (!clean.length) {
              // Empty chat: drop stale session so next load stays cold-clean.
              void invalidateEngineSession(modelId);
            } else if (writer.epoch() === epoch && writer.key()) {
              const ticket = writer.persist(snap, { epoch });
              if (ticket !== null && ticket.issued) {
                notifyConversationTouched(clean as Message[]);
                // .kvs keyed off the write LANDING: hashing a list the
                // store does not hold makes boot mismatch and drop it.
                void ticket.landed.then((landed) => {
                  if (landed) {
                    void saveEngineSession(
                      modelId,
                      computeHistoryHashFromMessages(clean),
                      clean.length,
                    );
                  }
                });
              } else {
                // Counts only in the log.
                console.warn("[historyGuard] history write refused", {
                  incoming: clean.length,
                  background: true,
                });
              }
            }
          }
        }
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [persistActiveMessages, notifyConversationTouched]);

}
