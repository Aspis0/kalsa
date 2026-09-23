/**
 * The chat side of a send: guards, the claim, the turn append, the run
 * through `runSendStream` into the lifted engine half, the four outcomes and
 * the release — composed, not re-derived: every order it keeps is pinned by
 * `src/host/{turnGuards,sendStream,historyWrite}.ts` and their tests (D2
 * rows 1, 3, 4, 5, 6, 11).
 *
 * What is NOT here (reported): the voice busy guard and the PDF-conversion
 * re-entry guard (this host's equivalents are the composer phase and the
 * attach flow's own flag), the chat-side pre-send fit gate (the load path
 * runs the same gate) and the OS thermal gate (it arrives as the `tooHot`
 * composer phase). The translate guard IS here — a translate holds the
 * engine and refuses a send, as the controller did (`Chat:2233`).
 *
 * The attachment half arrives through seams beside this file (which sits AT
 * its 350-line ratchet and may only shed weight): snapshot/clear ride
 * `params.attachments`, the composition is `sendComposition.ts`, the
 * outcomes `sendOutcomes.ts`, the adapter `sendEngineAdapter.ts`, the stop
 * closure `sendStop.createStopHandler`.
 */
import { useRef } from "react";
import { hasDeepResearchTrigger } from "../research/plan";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { createStreamCoalescer } from "../engine/streamCoalescer";
import {
  regenHandleSendPassRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";
import { classifyChatContent } from "../domain/contentFilter";
import { runSendStream, type SendUiHandlers } from "./sendStream";
import { armsSendOptions, researchIntentForBackend, shouldRefuseRemoteResearch } from "./composerArms";
import { sendClearsDraft } from "./sendDraft";
import { composeSendText } from "./sendComposition";
import { contentFilterMessage } from "./contentFilterCopy";
import type { EngineTurnDeps } from "./engineTurnDeps";
import { createRichCallbacks } from "./sendCallbacks";
import { createSendEngine } from "./sendEngineAdapter";
import { applySendOutcome } from "./sendOutcomes";
import { createStopHandler } from "./sendStop";
import { runBenchTurn } from "./benchTurn";
import { nextMsgId, type LocalAttachment, type Message } from "./hostMessage";
import { translationInFlightRef } from "./translateState";
import type { TranslateFn, TranslationKey } from "../i18n";
import type { TurnFence, TurnToken } from "./turnGuards";

export interface SendHostParams {
  t: TranslateFn;
  fence: TurnFence;
  engineDeps: EngineTurnDeps;
  messagesRef: { current: Message[] };
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  historyLoadedRef: { current: boolean };
  persist: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => HistoryWriteTicket | null;
  getEpoch: () => number;
  onSendingChange: (sending: boolean) => void;
  /** The volatile tool-row capture (D1 row 23: never persisted). */
  onToolCapture: (assistantId: string, name: string) => void;
  clearDraft: () => void;
  /** The field's current text: the send clears the field only when the field
   *  itself sent the words (`sendClearsDraft`). */
  draft: string;
  /** The one-slot notice (D1 row 40): where a truncated notes context speaks. */
  showNoticeKey: (key: TranslationKey) => void;
  /** The composer's one-shot research/notes arms (D1 row 14): read through
   *  the refs at send time and cleared at the controller's own point —
   *  after the content gate. */
  arms: {
    researchRef: { current: boolean };
    notesRef: { current: boolean };
    clear: () => void;
  };
  /** The composer's attachment rows (D1 row 43): snapshotted at send time;
   *  cleared when THIS send consumed them — a foreign send (card, edit,
   *  regenerate) never eats staged rows, the `sendDraft.ts` doctrine applied
   *  to rows (the controller cleared unconditionally, `Chat:2420,2525`). */
  attachments: { itemsRef: { current: readonly LocalAttachment[] }; clear: () => void };
  /** `Boolean(currentModel.mmproj)` — where the send's vision notices decide. */
  visionCapable: boolean;
}

export interface SendHost {
  /** `opts.edited` badges the re-sent user bubble (edit-then-resend);
   *  `attachments` is a FOREIGN attachment set (edit/regenerate re-send the
   *  target's own) — absent means "consume the composer's rows". */
  send: (
    text: string,
    opts?: { edited?: boolean },
    attachments?: readonly LocalAttachment[],
  ) => Promise<void>;
  stop: () => void;
  sendingRef: { current: boolean };
  abortRef: { current: AbortController | null };
  stopWatchdogRef: { current: ReturnType<typeof setTimeout> | null };
  currentTokenRef: { current: TurnToken | null };
  stopRequestedRef: { current: boolean };
  hasTokensRef: { current: boolean };
}

export function useSendHost(params: SendHostParams): SendHost {
  const { t, engineDeps, fence } = params;
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const stopWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTokenRef = useRef<TurnToken | null>(null);
  const stopRequestedRef = useRef(false);
  const hasTokensRef = useRef(false);

  const releaseOwned = (token: TurnToken) => {
    if (!fence.owns(token)) return;
    sendingRef.current = false;
    sendClaimRef.current = false;
    sendingInFlightRef.current = false;
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    stopRequestedRef.current = false;
    if (stopWatchdogRef.current != null) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    params.onSendingChange(false);
  };

  const send = async (
    text: string,
    opts?: { edited?: boolean },
    attachments?: readonly LocalAttachment[],
  ): Promise<void> => {
    const trimmed = text.trim();
    // The claim check (old controller minus the voice/PDF busy flags this
    // host does not have; the translate flag it DOES have): nothing to send
    // means no text AND nothing attached — an attachment-only send IS a send
    // (controller `Chat:3676`). Foreign callers (edit/regenerate) hand their
    // own attachments; the face, a card or the welcome block consume rows.
    const staged = attachments ?? params.attachments.itemsRef.current;
    if (
      (!trimmed && staged.length === 0) ||
      sendClaimRef.current ||
      sendingRef.current ||
      translationInFlightRef.current ||
      !params.historyLoadedRef.current
    ) {
      return;
    }
    // Reserve the claim BEFORE any await so a second send cannot enter.
    sendClaimRef.current = true;
    sendingInFlightRef.current = true;
    sendingRef.current = true;
    params.onSendingChange(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const token = fence.beginRun();
    currentTokenRef.current = token;
    hasTokensRef.current = false;
    stopRequestedRef.current = false;

    try {
      if (await runBenchTurn(fence, token, trimmed, params)) return;

      // Snapshot the attachment rows at send time (controller `Chat:2437`):
      // the array stamped on the user message and handed to the engine half
      // is frozen here, after every early return above.
      const snapshot = staged.slice();
      const consumedComposerRows = attachments === undefined;
      const stamped = snapshot.length > 0 ? snapshot : undefined;

      // Pre-send content gate — blocking categories never reach the model;
      // the localized decline becomes the assistant's message.
      const classification = classifyChatContent(trimmed);
      const userMsgId = nextMsgId("u");
      const assistantId = nextMsgId("a");
      const now = Date.now();
      if (!classification.shouldCallProvider) {
        params.setMessages((prev) =>
          fence.apply(token, prev, (state) => [
            ...state,
            { id: userMsgId, role: "user", text: trimmed, createdAt: now, attachments: stamped, ...(opts?.edited ? { edited: true } : {}) },
            {
              id: assistantId,
              role: "assistant",
              text: contentFilterMessage(classification.reason, t),
              streaming: false,
              createdAt: now + 1,
            },
          ]),
        );
        // The controller cleared the rows on the refused send too
        // (`setAttachedItems([])`, `Chat:2420`) — consumed rows only.
        if (consumedComposerRows) params.attachments.clear();
        if (sendClearsDraft(params.draft, trimmed)) params.clearDraft();
        return;
      }

      const remoteBackend = isRemoteEngineBackend();
      const keywordResearch = hasDeepResearchTrigger(trimmed);
      if (shouldRefuseRemoteResearch(remoteBackend, params.arms.researchRef.current || keywordResearch)) params.showNoticeKey("settings.remoteGated");
      const useResearch = researchIntentForBackend(remoteBackend, keywordResearch);
      // The one-shot arms: captured AND cleared after the gate, before the
      // append — a keyword-only research send still clears an armed notes
      // mode, as the controller did.
      const armsOptions = armsSendOptions(
        researchIntentForBackend(remoteBackend, params.arms.researchRef.current),
        params.arms.notesRef.current,
        useResearch,
      );
      if (params.arms.researchRef.current || params.arms.notesRef.current) {
        params.arms.clear();
      }
      // The doc-hint annotation, the empty-caption fallback and this send's
      // ONE notice live in `sendComposition.ts` (controller `Chat:2438-2477`).
      const composition = composeSendText({
        trimmed,
        attachments: snapshot,
        research: useResearch,
        visionCapable: params.visionCapable,
        attachedFileLabel: t("chat.lookAtAttachedFile"),
      });
      if (composition.notice) params.showNoticeKey(composition.notice);
      const modelText = composition.modelText;

      params.setMessages((prev) =>
        fence.apply(token, prev, (state) => [
          ...state,
          { id: userMsgId, role: "user", text: trimmed, createdAt: now, attachments: stamped, ...(opts?.edited ? { edited: true } : {}) },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            streaming: true,
            // Prefill + the think block come before any visible token; the
            // engine flips the label on the first VISIBLE content token.
            statusLabel: t("chat.thinkingStatus"),
            statusHistory: [],
            createdAt: now,
          },
        ]),
      );
      if (sendClearsDraft(params.draft, trimmed)) params.clearDraft();
      // Rows clear only when THIS send consumed them (the controller cleared
      // them on every append, `Chat:2525`; a foreign send keeps staged rows).
      if (consumedComposerRows) params.attachments.clear();

      // ~30 fps UI flush: llama.rn is 5-15 tok/s; setState every token is
      // wasteful. The coalescer overwrites with the latest full text.
      const streamCoalescer = createStreamCoalescer((fullText) => {
        params.setMessages((prev) =>
          fence.apply(token, prev, (state) =>
            state.map((message) =>
              // Keep statusLabel: the engine owns the thinking→writing
              // transition and clearing here would flicker the chip off.
              message.id === assistantId ? { ...message, text: fullText } : message,
            ),
          ),
        );
      });

      const rich = createRichCallbacks({
        fence,
        token,
        assistantId,
        setMessages: params.setMessages,
        onToolCapture: params.onToolCapture,
        t: t as unknown as (key: string, params?: Record<string, string | number>) => string,
      });
      // The history handed to assembly is the PRE-append snapshot: the just-
      // sent turn is appended by the engine half itself and must not be
      // double-counted here. The adapter is `sendEngineAdapter.ts` — the
      // seam this file cut to take the attachments under its ratchet.
      const engine = createSendEngine({ engineDeps, rich, attachments: snapshot });
      const ui: SendUiHandlers = {
        onToken: (_delta, full) => {
          hasTokensRef.current = true;
          if (!fence.owns(token)) return;
          streamCoalescer.push(full);
        },
        onSources: (sources) => rich.callbacks.onSources?.(sources as any[]),
      };
      const request = {
        text: modelText,
        // The typed seam carries the same frozen snapshot the engine half
        // receives below (`sendStream.SendRequest.attachments`).
        attachments: snapshot,
        history: params.messagesRef.current,
        // Research or armed notes hand the engine its options. A truncated
        // notes context speaks through this build's single notice slot
        // (D1 row 40) — the controller sent the same catalogue line to its
        // voice-note toast (`AiChatPage.tsx:2710`), which this build lacks.
        options: armsOptions
          ? { ...armsOptions, onNotice: () => params.showNoticeKey("chat.notesContextTruncated") }
          : undefined,
      };

      const result = await runSendStream(engine, request as any, ui, controller.signal);
      // Drain or drop the coalescer BEFORE the outcome so the last token is
      // not stuck in a pending timeout, and discarded aborts never paint.
      if (result.kind === "aborted") {
        streamCoalescer.cancel();
      } else {
        streamCoalescer.finalize();
      }
      if (fence.owns(token)) {
        // The four outcomes moved to `sendOutcomes.ts` — the seam this file
        // cut to take the attachment snapshot under its 350-line ratchet.
        applySendOutcome(
          result,
          {
            fence,
            token,
            assistantId,
            messagesRef: params.messagesRef,
            setMessages: params.setMessages,
            persist: params.persist,
            getEpoch: params.getEpoch,
            t,
          },
          rich.captured(),
        );
      }
    } finally {
      releaseOwned(token);
    }
  };

  // The stop closure lives in `sendStop.ts` (`createStopHandler`) — the
  // second seam this file cut under its 350-line ratchet; the handler and
  // its watchdog are unchanged.
  const stop = createStopHandler(params, {
    abortRef,
    stopWatchdogRef,
    currentTokenRef,
    sendingRef,
    stopRequestedRef,
  });

  return {
    send,
    stop,
    sendingRef,
    abortRef,
    stopWatchdogRef,
    currentTokenRef,
    stopRequestedRef,
    hasTokensRef,
  };
}
