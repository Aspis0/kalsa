/**
 * The synchronous truncate → claim → declare handoff that BOTH the menu's
 * regenerate and the edit modal's save enter — one implementation, because
 * they are the same user action with different text. It re-expresses the
 * controller's shared truncate-and-resend: `editMessage`
 * (`AiChatPage.tsx:3329-3465`) and the regenerate row (`Chat:4468-4486`)
 * both truncate at a target user turn, arm the declared shrink and hand the
 * resend to `handleSend`; here the send path owns the claim and the release,
 * exactly as it does for any other send.
 *
 * The order is the fence: no `await` sits between the caller's checks, the
 * truncate, `send()`'s own claim and the declared shrink, so no other flow
 * can run in between. The rollback only exists for the impossible case where
 * the claim did not take, and it must also undo the truncate and the lock —
 * before the first await, never after `run` settles (rolling back into a
 * finished turn would resurrect the dropped answer).
 */
import { regenInFlightRef } from "../engine/regenState";
import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import type { TranslationKey } from "../i18n";
import type { HistoryWriteGuard } from "../chat/historyWriteGuard";
import type { Message } from "./hostMessage";
import type { LocalAttachment } from "./hostMessage";
import type { SendHost } from "./sendHost";

export interface ResendPlan {
  /** History BEFORE the target user turn — the truncate target. */
  base: Message[];
  /** The user text to re-send (regenerated or edited). */
  text: string;
  /** The target's attachments, re-sent with it — NEVER the composer's
   *  staged rows: a foreign send leaves those alone (`send`'s third
   *  argument distinguishes them). */
  attachments?: LocalAttachment[] | undefined;
}

export interface ResendDeps {
  history: {
    messagesRef: { current: Message[] };
    setMessages: (updater: (prev: Message[]) => Message[]) => void;
    /** The write guard: the shrink must be DECLARED or the write is refused. */
    historyGuard: HistoryWriteGuard;
  };
  sendHost: Pick<SendHost, "send" | "sendingRef">;
  showNoticeKey: (key: TranslationKey) => void;
}

/** True when the claim took and the run is under way; false after the
 *  rollback, which has already reported `chat.regenFailed`. */
export async function truncateAndResend(
  deps: ResendDeps,
  plan: ResendPlan,
  opts: { edited?: boolean } = {},
): Promise<boolean> {
  const { history, sendHost, showNoticeKey } = deps;
  const snapshot = history.messagesRef.current;
  // ── one synchronous block: lock → truncate → claim → declare ──
  regenInFlightRef.current = true;
  // The edit/regenerate acquire is user activity (`Chat:3353`); synchronous,
  // so the no-await order the header pins is untouched.
  bumpForegroundIdleRef.current();
  history.setMessages(() => plan.base);
  history.messagesRef.current = plan.base;
  // Third argument = FOREIGN attachments: `send` then knows not to consume
  // (or clear) the composer's own rows. One line so `messageActions.test`'s
  // ordering needle (lock → truncate → send → declare) keeps its shape.
  const run = sendHost.send(plan.text, opts.edited ? { edited: true } : undefined, plan.attachments ?? []);
  if (!sendHost.sendingRef.current) {
    // `send` refused synchronously — impossible after the caller's checks
    // (identical gates, no await between), so this is a defensive rollback
    // and it must also undo the truncate and the lock it took.
    history.setMessages(() => snapshot);
    history.messagesRef.current = snapshot;
    regenInFlightRef.current = false;
    showNoticeKey("chat.regenFailed");
    return false;
  }
  // The claim is provably taken: arm the shrink BEFORE the first await, so
  // the first flush or turn-end write of `plan.base` is the declared one.
  history.historyGuard.armDeclaredShrink(plan.base);
  // The lock is released by the run itself (`sendHost.releaseOwned`, which
  // clears `regenInFlightRef` for the owning token) or by the stop watchdog /
  // conversation change.
  try {
    await run;
  } catch (error) {
    // The run began, so its own outcomes own the history — no rollback here.
    // Counts-only: never the message text.
    console.warn("[truncateAndResend] run threw", error);
  }
  return true;
}
