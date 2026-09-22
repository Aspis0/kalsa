/**
 * One conversation's messages: the write guard + epoch writer, the touch
 * notify, the persist wrapper and the LOAD path.
 *
 * What changed and why (reported): `persistEpochRef` / `persistKeyRef` /
 * `historyGuard`-as-raw-writer are replaced by `createHistoryWriter`
 * (`src/host/historyWrite.ts`) over the SAME `createHistoryWriteGuard` —
 * the epoch is checked before the build and again before the write inside
 * the writer (D2 row 1), and the load path stamps its bump through
 * `writer.bumpEpoch()` exactly where the old screen bumped its ref.
 * `setDraft` / `setLongChatNudgeShown` left the load effect as one
 * `onConversationEnter()` call; the flush/empty/epoch REF slots became
 * direct functions (`flushPartial`, `isActiveChatEmpty`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import {
  createHistoryWriteGuard,
  type BegunHistoryLoad,
  type HistoryWriteGuard,
  type HistoryWriteTicket,
} from "../chat/historyWriteGuard";
import { createHistoryWriter, type HistoryWriter } from "./historyWrite";
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";
import {
  messagesKey,
  previewFromMessages,
  searchBlobFromMessages,
  titleFromFirstUserText,
} from "../conversations/ConversationsStore";
import type { Message } from "./hostMessage";
import type { Locale, TranslateFn } from "../i18n";

export interface HistoryHostParams {
  t: TranslateFn;
  locale: Locale;
  /** Active conversation — a change re-runs the lifted load effect. */
  conversationId: string | undefined;
  /** The root clears draft/tool rows when a conversation (re)enters. */
  onConversationEnter: () => void;
  /** Fresh title/preview/searchBlob for the ACTIVE meta after a write. */
  onConversationTouched: (meta: {
    title: string;
    preview: string;
    searchBlob: string;
  }) => void;
}

export function useHistoryHost(params: HistoryHostParams): {
  messages: Message[];
  messagesRef: { current: Message[] };
  historyLoaded: boolean;
  historyLoadedRef: { current: boolean };
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  notifyConversationTouched: (msgs: Message[]) => void;
  writer: HistoryWriter<Message>;
  historyGuard: HistoryWriteGuard;
  persistActiveMessages: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => HistoryWriteTicket | null;
  flushPartial: () => void;
  isActiveChatEmpty: () => boolean;
} {
  const { t, locale, conversationId, onConversationEnter, onConversationTouched } = params;
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyLoadedRef = useRef(historyLoaded);
  historyLoadedRef.current = historyLoaded;
  const onConversationTouchedRef = useRef(onConversationTouched);
  onConversationTouchedRef.current = onConversationTouched;

  const { historyGuard, writer } = useMemo(() => {
    const guard = createHistoryWriteGuard(AsyncStorage);
    const epochWriter = createHistoryWriter<Message>({
      guard,
      project: (snapshot, opts) => buildPersistableMessages(snapshot as Message[], opts),
      // Rejection must reach the guard or it would adopt a baseline the
      // store does not hold (same non-fatal surface as the old path).
      write: (key, json) =>
        AsyncStorage.setItem(key, json).catch((err) => {
          console.warn("[persistMessages]", err);
          throw err;
        }),
      // Refusal: counts only — never keys, ids or text.
      onRefused: (incomingCount) =>
        console.warn("[historyGuard] history write refused", {
          incoming: incomingCount,
        }),
    });
    return { historyGuard: guard, writer: epochWriter };
  }, []);
  const notifyConversationTouched = useCallback((msgs: Message[]) => {
    const cb = onConversationTouchedRef.current;
    if (!cb) return;
    const firstUser = msgs.find(
      (m) => m.role === "user" && typeof m.text === "string" && m.text.trim(),
    );
    cb({
      title: titleFromFirstUserText(firstUser?.text ?? ""),
      preview: previewFromMessages(msgs),
      searchBlob: searchBlobFromMessages(msgs),
    });
  }, []);

  const persistActiveMessages = useCallback(
    (
      msgs: Message[],
      opts?: { allowStreamingPartial?: boolean; epoch?: number },
    ): HistoryWriteTicket | null => {
      const ticket = writer.persist(msgs, {
        epoch: opts?.epoch,
        allowStreamingPartial: opts?.allowStreamingPartial,
      });
      if (ticket?.issued) notifyConversationTouched(msgs);
      return ticket;
    },
    [notifyConversationTouched, writer],
  );

  /** The old `persistFlushRef` body, called directly. */
  const flushPartial = useCallback(() => {
    persistActiveMessages(messagesRef.current, {
      allowStreamingPartial: true,
      epoch: writer.epoch(),
    });
  }, [persistActiveMessages, writer]);

  /** The old `isActiveChatEmptyRef` body. */
  const isActiveChatEmpty = useCallback(() => {
    if (!historyLoadedRef.current) return false;
    if (messagesRef.current.length > 0) return false;
    // Poisoned state: the screen shows 0 but the store holds a raw the
    // guard has not (yet) preserved. Report NOT empty so "New chat" really
    // starts a conversation instead of keeping the user here.
    return !historyGuard.storeKnownToHoldMessages();
  }, [historyGuard]);
  useEffect(() => {
    const loadEpoch = writer.bumpEpoch();
    let key = "";
    try {
      key = conversationId ? messagesKey(conversationId) : "";
    } catch {
      key = "";
    }
    writer.bindKey(key);

    setMessages([]);
    messagesRef.current = [];
    onConversationEnter();
    setHistoryLoaded(false);

    if (!key) {
      setHistoryLoaded(true);
      return;
    }

    let mounted = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!mounted || writer.epoch() !== loadEpoch) return;
        // The guard classifies the load by message IDENTITY; a lossy raw is
        // preserved in the quarantine key before any write can be issued
        // (locale is already resolved — the app gates on localeReady).
        let begun: BegunHistoryLoad<Message>;
        try {
          begun = historyGuard.beginHistoryLoad(raw, key, (entries) =>
            sanitizeHistoryMessages(entries, locale),
          );
        } catch {
          // A throw here must not leave the gate closed with no user signal:
          // treat it like a failed preservation.
          try {
            Alert.alert(
              t("chat.historyGuardTitle"),
              t("chat.historyGuardBody"),
            );
          } catch {
            // Alert unavailable (tests / headless) — refusal still holds.
          }
          return undefined;
        }
        // Show what could be read and open the composer BEFORE awaiting the
        // preservation copy — the write gate stays closed meanwhile, and one
        // refused write beats a blank wedged chat.
        if (begun.messages.length) {
          setMessages(begun.messages);
          messagesRef.current = begun.messages;
        }
        setHistoryLoaded(true);
        return historyGuard.settleHistoryLoad();
      })
      .then((settled) => {
        if (!settled || !mounted || writer.epoch() !== loadEpoch) {
          return;
        }
        if (settled.preservationFailed) {
          // Without this Alert the only symptom is "my new messages never
          // survive a restart".
          try {
            Alert.alert(
              t("chat.historyGuardTitle"),
              t("chat.historyGuardBody"),
            );
          } catch {
            // Alert unavailable (tests / headless) — refusal still holds.
          }
        } else if (settled.unreadable) {
          // The raw existed but nothing readable came out of it: never let
          // the person believe an emptied chat means a lost conversation.
          try {
            Alert.alert(
              t("chat.historyUnreadableTitle"),
              t("chat.historyUnreadableBody"),
            );
          } catch {
            // Alert unavailable (tests / headless).
          }
        } else if (settled.droppedCount > 0) {
          // The chat is not silently smaller than it was: say what happened.
          try {
            Alert.alert(
              t("chat.historyPartialTitle"),
              t("chat.historyPartialBody", { count: settled.droppedCount }),
            );
          } catch {
            // Alert unavailable (tests / headless).
          }
        }
        if (!settled.preservationFailed && settled.lossy) {
          // Writes made while the gate was closed were refused; flush what
          // the user typed in that window now that the gate is open. Every
          // lossy shape is covered here — count drops, duplicate-id drops,
          // text-shrink — not just the ones with an alert.
          persistActiveMessages(messagesRef.current, {
            epoch: writer.epoch(),
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted && writer.epoch() === loadEpoch) {
          setHistoryLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
    // Reload when the active conversation changes (locale is stable after
    // the LocaleProvider ready gate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  return {
    messages,
    messagesRef,
    historyLoaded,
    historyLoadedRef,
    setMessages,
    notifyConversationTouched,
    writer,
    historyGuard,
    persistActiveMessages,
    flushPartial,
    isActiveChatEmpty,
  };
}
