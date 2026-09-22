/**
 * Edit-then-resend: the controller's edit modal (`AiChatPage.tsx:4500-4581`)
 * and its `editMessage` save half (`Chat:3329-3465`, busy guard `:3343-3347`),
 * as the host's own state beside the menu.
 *
 * The truncate half is NOT re-implemented: the plan comes from `regenPlan.ts`
 * (same file a regenerate's plan comes from) and the synchronous
 * lock → truncate → claim → declare block is `truncateAndResend`, the one
 * handoff both actions share — the controller's `editMessage` is where its
 * regenerate row went too (`Chat:4479`).
 *
 * The modal stays OPEN on a refused save (the controller did: a failed
 * `editMessage` returned a reason key and left `editingMessage` set) and the
 * failure key rides this build's single notice slot.
 */
import { useCallback, useEffect, useState } from "react";
import { regenInFlightRef, sendClaimRef } from "../engine/regenState";
import type { TranslationKey } from "../i18n";
import type { HistoryWriteGuard } from "../chat/historyWriteGuard";
import type { Message } from "./hostMessage";
import { planEdit } from "./regenPlan";
import { truncateAndResend } from "./truncateAndResend";
import type { SendHost } from "./sendHost";

export interface EditMessageParams {
  /** The rendering mirror: a live turn must not keep the modal open. */
  sending: boolean;
  sendHost: Pick<SendHost, "send" | "sendingRef">;
  history: {
    messagesRef: { current: Message[] };
    historyLoadedRef: { current: boolean };
    setMessages: (updater: (prev: Message[]) => Message[]) => void;
    historyGuard: HistoryWriteGuard;
  };
  showNoticeKey: (key: TranslationKey) => void;
}

export interface EditMessage {
  /** The open modal's draft, or null when the modal is closed. */
  editing: { id: string; draft: string } | null;
  open: (id: string, draft: string) => void;
  setDraft: (draft: string) => void;
  close: () => void;
  /** Save: guards → plan → the shared handoff; closes only on success. */
  submit: () => Promise<void>;
}

export function useEditMessage(params: EditMessageParams): EditMessage {
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  // A live turn must not keep the edit sheet open — Save would race the
  // stream (the controller's effect, `Chat:3467-3471`). A save's own claim
  // flips `sending` too, so this also closes the modal on success; a refused
  // save never claims, so the modal stays open over its notice.
  useEffect(() => {
    if (params.sending) setEditing(null);
  }, [params.sending]);

  const open = useCallback((id: string, draft: string) => setEditing({ id, draft }), []);
  const setDraft = useCallback(
    (draft: string) => setEditing((previous) => (previous ? { ...previous, draft } : previous)),
    [],
  );
  const close = useCallback(() => setEditing(null), []);

  const submit = useCallback(async () => {
    const target = editing;
    if (!target) return;
    // The controller's busy guard, refs only (`Chat:3343-3347`).
    if (
      regenInFlightRef.current ||
      params.sendHost.sendingRef.current ||
      sendClaimRef.current ||
      !params.history.historyLoadedRef.current
    ) {
      params.showNoticeKey("chat.regenBusy");
      return;
    }
    // This build has no attachments (PARITY D1 row 43), so an empty caption
    // is never valid — the controller's `chat.editEmpty` (`Chat:3345-3349`).
    const plan = planEdit(params.history.messagesRef.current, target.id, target.draft);
    if (!plan) {
      params.showNoticeKey(
        target.draft.trim() ? "chat.regenFailed" : "chat.editEmpty",
      );
      return;
    }
    const ok = await truncateAndResend(
      {
        history: params.history,
        sendHost: params.sendHost,
        showNoticeKey: params.showNoticeKey,
      },
      plan,
      { edited: true },
    );
    if (ok) setEditing(null);
  }, [editing, params]);

  return { editing, open, setDraft, close, submit };
}
