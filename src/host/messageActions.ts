/**
 * The message interactions' host half: the long-press menu's payload, the
 * copied flash, save-to-notes and the regenerate handoff (PARITY-STATUS
 * gap 1 / D1 rows 15, 16, 20, 21). Beside `sendHost`, not inside it: the
 * regenerate it performs ENTERS `sendHost.send` like any other send, so the
 * claim, the turn token, the engine half and the release are the send's own
 * fences — a regenerate is fenced exactly like a send because it IS one.
 *
 * Two traps the controller records, both honored here:
 *
 * 1. **Refs only in the opener**: a closure over state froze the menu's
 *    payload inside memoized rows. The guards below read `sendingRef` /
 *    `regenInFlightRef` / `historyLoadedRef`, never this component's
 *    `sending` state, and the latest non-ref inputs (`send`, `t`, the notice)
 *    arrive through a params ref refreshed every render.
 * 2. **Close the menu when a turn starts**: a live turn must not keep the
 *    sheet open, so `sending` closing it is kept.
 *
 * Timers: the copied flash and the sheet's +400 ms close, both cleared on
 * close/unmount exactly where the controller cleared them.
 *
 * Deferred, NOT built (reported, not stubbed): translate, edit, read-aloud —
 * and therefore no `translationInFlightRef` guard (there is no translate to
 * contend with) and no `onSpeak`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  regenInFlightRef,
  sendClaimRef,
} from "../engine/regenState";
import { saveNote } from "../notes/NotesStore";
import { COPIED_FLASH_MS } from "../ui/shell/copiedFlash";
import type { MessageMenuRow } from "../ui/shell/MessageMenu";
import type { HistoryWriteGuard } from "../chat/historyWriteGuard";
import type { TranslateFn, TranslationKey } from "../i18n";
import { copyToClipboard } from "./copyText";
import { messageMenuCaption, messageMenuRows } from "./messageMenuRows";
import type { Message } from "./hostMessage";
import { planRegenerate } from "./regenPlan";
import type { SendHost } from "./sendHost";

/** What this hook borrows from the root: the send fence it hands the resend
 *  into, and the conversation's messages + shrink guard it truncates. */
export interface MessageActionsParams {
  t: TranslateFn;
  /** The root's rendering mirror; the guards read the ref, never this. */
  sending: boolean;
  sendHost: Pick<SendHost, "send" | "sendingRef">;
  history: {
    messagesRef: { current: Message[] };
    setMessages: (updater: (prev: Message[]) => Message[]) => void;
    historyLoadedRef: { current: boolean };
    /** The write guard: a truncate must be DECLARED or the shrink write is
     *  refused (the controller's `armDeclaredShrink(base)`). */
    historyGuard: HistoryWriteGuard;
  };
  showNoticeKey: (key: TranslationKey) => void;
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
      // event's own message, so nothing here can be stale.
      const p = latest.current;
      if (
        p.sendHost.sendingRef.current ||
        regenInFlightRef.current ||
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
   * Regenerate: declare the shrink, truncate, and hand the resend to
   * `send()` — one synchronous block, because the claim `send` reserves
   * before its first await is what fences the truncate: no await sits between
   * the checks, the truncate and the claim, so no other flow can run in
   * between, and everything after the claim is the send's own turn token.
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
    const snapshot = p.history.messagesRef.current;
    // ── one synchronous block: truncate → claim → declare ──
    regenInFlightRef.current = true;
    p.history.setMessages(() => plan.base);
    p.history.messagesRef.current = plan.base;
    const run = p.sendHost.send(plan.text);
    if (!p.sendHost.sendingRef.current) {
      // `send` refused synchronously — impossible after the checks above
      // (identical gates, no await between), so this is a defensive rollback
      // and it must also undo the truncate and the lock it took.
      p.history.setMessages(() => snapshot);
      p.history.messagesRef.current = snapshot;
      regenInFlightRef.current = false;
      p.showNoticeKey("chat.regenFailed");
      return;
    }
    // The claim is provably taken: arm the shrink BEFORE the first await, so
    // the first flush or turn-end write of `plan.base` is the declared one.
    p.history.historyGuard.armDeclaredShrink(plan.base);
    // The lock is released by the run itself (`sendHost.releaseOwned`, which
    // clears `regenInFlightRef` for the owning token) or by the stop watchdog
    // / conversation change.
    try {
      await run;
    } catch (error) {
      // The run began, so its own outcomes own the history — no rollback here
      // (rolling back into a finished turn would resurrect the dropped answer).
      // Counts-only: never the message text.
      console.warn("[messageActions] regenerate run threw", error);
    }
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
      if (id === "regenerate") {
        const assistantId = payload.id;
        closeMenu();
        void regenerate(assistantId);
        return;
      }
      closeMenu(); // cancel
    },
    [closeMenu, regenerate, saveToNotes],
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
  };
}
