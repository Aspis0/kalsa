/**
 * The message interactions' host half: the long-press menu's payload, the
 * copied flash, save-to-notes, regenerate, translate, edit-then-resend and
 * read-aloud (PARITY-STATUS gap 1 / D1 rows 15-21). Beside `sendHost`, not
 * inside it: the regenerate and the edit SAVE both ENTER `sendHost.send` like
 * any other send, so the claim, the turn token, the engine half and the
 * release are the send's own fences — a regenerate or an edit is fenced
 * exactly like a send because it IS one. The synchronous truncate → claim →
 * declare block they share is `truncateAndResend.ts`; the translate run and
 * its orphan cleanup are `useTranslateMessage.ts`, the edit modal's state
 * `useEditMessage.ts`, the voice `useReadAloud.ts`.
 *
 * Two traps the controller records, both honored here:
 *
 * 1. **Refs only in the opener**: a closure over state froze the menu's
 *    payload inside memoized rows. The guards below read `sendingRef` /
 *    `regenInFlightRef` / `translationInFlightRef` / `historyLoadedRef`,
 *    never this component's `sending` state, and the latest non-ref inputs
 *    (`send`, `t`, the notice) arrive through a params ref refreshed every
 *    render.
 * 2. **Close the menu when a turn starts**: a live turn must not keep the
 *    sheet open, so `sending` closing it is kept.
 *
 * Timers: the copied flash and the sheet's +400 ms close, both cleared on
 * close/unmount exactly where the controller cleared them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { regenInFlightRef, sendClaimRef } from "../engine/regenState";
import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import { saveNote } from "../notes/NotesStore";
import { COPIED_FLASH_MS } from "../ui/shell/copiedFlash";
import type { MessageMenuRow } from "../ui/shell/MessageMenu";
import type { TranscriptTranslateAction } from "../ui/shell/transcriptTypes";
import type { HistoryWriteGuard } from "../chat/historyWriteGuard";
import type { Locale, TranslateFn, TranslationKey } from "../i18n";
import { copyToClipboard } from "./copyText";
import { messageMenuCaption, messageMenuRows } from "./messageMenuRows";
import type { Message } from "./hostMessage";
import { planRegenerate } from "./regenPlan";
import { truncateAndResend } from "./truncateAndResend";
import { translationInFlightRef } from "./translateState";
import { useEditMessage } from "./useEditMessage";
import { useReadAloud } from "./useReadAloud";
import { useTranslateMessage } from "./useTranslateMessage";
import type { SendHost } from "./sendHost";

/** What this hook borrows from the root: the send fence it hands the resend
 *  into, the conversation's messages + shrink guard it truncates, and the two
 *  ports the live interactions need (locale, TTS preference). */
export interface MessageActionsParams {
  t: TranslateFn;
  /** The settings language: captured at a translate run's start. */
  locale: Locale;
  /** The root's rendering mirror; the guards read the ref, never this. */
  sending: boolean;
  sendHost: Pick<SendHost, "send" | "sendingRef">;
  history: {
    /** The rendering mirror: the translate orphan cleanup reads it. */
    messages: readonly Message[];
    messagesRef: { current: Message[] };
    setMessages: (updater: (prev: Message[]) => Message[]) => void;
    historyLoadedRef: { current: boolean };
    /** The write guard: a truncate must be DECLARED or the shrink write is
     *  refused (the controller's `armDeclaredShrink(base)`). */
    historyGuard: HistoryWriteGuard;
  };
  showNoticeKey: (key: TranslationKey) => void;
  /** The active conversation: a translate or a voice must not outlive it. */
  conversationId: string | undefined;
  /** The scan's TTS preference (`usePipelineScans`); read-aloud checks it. */
  ttsEnabled: boolean;
}

export type MessageMenuView = {
  caption: string;
  rows: MessageMenuRow[];
};

type MenuPayload = { id: string; role: "user" | "assistant"; text: string };

export interface MessageActions {
  /** The open menu as the sheet draws it, or null. */
  menu: MessageMenuView | null;
  onMessageLongPress: (message: {
    id: string;
    role: "user" | "assistant";
    text: string;
    caret?: boolean;
  }) => void;
  closeMenu: () => void;
  onMenuRow: (id: MessageMenuRow["id"]) => void;
  /** The copy both the menu row and the inline chip go through. */
  onCopy: (text: string) => Promise<boolean>;
  /** The translate run under one message (the band draws it), or null. */
  translate: TranscriptTranslateAction | null;
  /** True while a translate holds the engine — the send face dims on it. */
  translating: boolean;
  /** Read-aloud: the id whose chip reads "Stop reading", and the toggle. */
  speakingId: string | null;
  onSpeak: (id: string, text: string) => void;
  /** The edit modal's draft while open; null closes the modal. */
  edit: { draft: string } | null;
  onEditDraftChange: (draft: string) => void;
  onEditSubmit: () => void;
  onEditClose: () => void;
}

export function useMessageActions(params: MessageActionsParams): MessageActions {
  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<MenuPayload | null>(null);
  menuRef.current = menu;
  const copiedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest non-ref inputs without breaking callback identity (see header 1).
  const latest = useRef(params);
  latest.current = params;

  const clearTimers = () => {
    if (copiedFlashTimer.current) {
      clearTimeout(copiedFlashTimer.current);
      copiedFlashTimer.current = null;
    }
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  // The three live interactions, composed beside the menu they hang from.
  const translate = useTranslateMessage({
    locale: params.locale,
    conversationId: params.conversationId,
    messages: params.history.messages,
    sendingRef: params.sendHost.sendingRef,
    closeMenu,
  });
  const edit = useEditMessage({
    sending: params.sending,
    sendHost: params.sendHost,
    history: params.history,
    showNoticeKey: params.showNoticeKey,
  });
  const readAloud = useReadAloud({
    locale: params.locale,
    conversationId: params.conversationId,
    ttsEnabled: params.ttsEnabled,
    showNoticeKey: params.showNoticeKey,
    closeMenu,
  });
  // The hooks' callbacks are identity-stable; the view/state fields are not,
  // so the dispatch and the return below read the latest through these names.
  const { view: translationView, translating, run: runTranslate, retry: retryTranslate, close: closeTranslation, toggle: toggleTranslation } = translate;
  const { editing, open: openEdit, setDraft: setEditDraft, close: closeEdit, submit: submitEdit } = edit;
  const { speakingId, speak } = readAloud;

  // The controller's two timer effects: a closed menu drops its pending close;
  // unmount drops both.
  useEffect(() => {
    if (menu) return;
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current);
      menuCloseTimer.current = null;
    }
  }, [menu]);
  useEffect(
    () => () => {
      clearTimers();
    },
    [],
  );

  // A live turn must not keep the sheet open.
  useEffect(() => {
    if (params.sending) setMenu(null);
  }, [params.sending]);

  const onMessageLongPress = useCallback(
    (message: { id: string; role: "user" | "assistant"; text: string; caret?: boolean }) => {
      // REFs ONLY for the busy gates — a state-capturing closure froze the
      // payload inside memoized rows. The payload below comes from the press
      // event's own message, so nothing here can be stale. The translation
      // ref is the controller's own third gate (`Chat:3495`): a translate
      // holds the engine, so the sheet — with its Translate and Regenerate
      // rows — must not open over it.
      const p = latest.current;
      if (
        p.sendHost.sendingRef.current ||
        regenInFlightRef.current ||
        translationInFlightRef.current ||
        !p.history.historyLoadedRef.current
      ) {
        return;
      }
      if (message.caret === true) return; // still arriving (`streaming` guard)
      if (!message.text.trim()) return; // nothing copyable, nothing to resend
      setMenu({ id: message.id, role: message.role, text: message.text });
    },
    [],
  );

  /** Save-to-notes: same guard, same two notice keys. */
  const saveToNotes = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      await saveNote(text);
      latest.current.showNoticeKey("notes.saved");
    } catch {
      latest.current.showNoticeKey("notes.errorSave");
    }
  }, []);

  /**
   * Regenerate: checks and plan here, then the shared handoff — one
   * synchronous block from the caller's last check to the declared shrink,
   * because the claim `send` reserves before its first await is what fences
   * the truncate (`truncateAndResend.ts`).
   */
  const regenerate = useCallback(async (assistantId: string) => {
    const p = latest.current;
    // The controller's synchronous claim, reduced to the locks this host holds.
    if (
      sendClaimRef.current ||
      p.sendHost.sendingRef.current ||
      regenInFlightRef.current ||
      !p.history.historyLoadedRef.current
    ) {
      p.showNoticeKey("chat.regenBusy");
      return;
    }
    const plan = planRegenerate(p.history.messagesRef.current, assistantId);
    if (!plan) {
      p.showNoticeKey("chat.regenFailed");
      return;
    }
    await truncateAndResend(
      { history: p.history, sendHost: p.sendHost, showNoticeKey: p.showNoticeKey },
      plan,
    );
  }, []);

  const onMenuRow = useCallback(
    (id: MessageMenuRow["id"]) => {
      const payload = menuRef.current;
      if (!payload) return;
      if (id === "copy") {
        // Keep the sheet open ~400ms with "Copied!": await the clipboard
        // first, and a failed copy leaves the row as it was.
        void (async () => {
          const ok = await copyToClipboard(payload.text);
          if (!ok) return;
          setCopied(true);
          if (copiedFlashTimer.current) clearTimeout(copiedFlashTimer.current);
          copiedFlashTimer.current = setTimeout(() => {
            copiedFlashTimer.current = null;
            setCopied(false);
          }, COPIED_FLASH_MS);
          if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current);
          menuCloseTimer.current = setTimeout(() => {
            menuCloseTimer.current = null;
            setMenu(null);
          }, COPIED_FLASH_MS);
        })();
        return;
      }
      if (id === "notes") {
        closeMenu();
        void saveToNotes(payload.text);
        return;
      }
      if (id === "translate") {
        // The run closes the menu itself, as `runTranslate` did (`Chat:3542`).
        runTranslate(payload.id, payload.text);
        return;
      }
      if (id === "edit") {
        closeMenu();
        openEdit(payload.id, payload.text);
        return;
      }
      if (id === "regenerate") {
        const assistantId = payload.id;
        closeMenu();
        void regenerate(assistantId);
        return;
      }
      closeMenu(); // cancel
    },
    [closeMenu, regenerate, saveToNotes, runTranslate, openEdit],
  );

  const menuView = useMemo<MessageMenuView | null>(() => {
    if (!menu) return null;
    const rows: MessageMenuRow[] = messageMenuRows(menu.role, menu.text, params.sending).map(
      (spec) => ({
        id: spec.id,
        label:
          spec.id === "copy" && copied ? params.t("common.copied") : params.t(spec.labelKey),
        testID: spec.testID,
      }),
    );
    return { caption: params.t(messageMenuCaption(copied)), rows };
  }, [menu, copied, params.sending, params.t]);

  return {
    menu: menuView,
    onMessageLongPress,
    closeMenu,
    onMenuRow,
    onCopy: copyToClipboard,
    translate:
      translationView === null
        ? null
        : {
            view: translationView,
            onToggle: toggleTranslation,
            onClose: closeTranslation,
            onRetry: retryTranslate,
          },
    translating,
    speakingId,
    onSpeak: speak,
    edit: editing === null ? null : { draft: editing.draft },
    onEditDraftChange: (draft: string) => {
      // Keystrokes in the edit modal bump the idle clock (`Chat:4526`).
      setEditDraft(draft);
      bumpForegroundIdleRef.current();
    },
    onEditSubmit: () => void submitEdit(),
    onEditClose: closeEdit,
  };
}
