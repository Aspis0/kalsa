/**
 * The chat side of a send: guards, the claim, the turn append, the run
 * through `runSendStream` into the lifted engine half, the four outcomes and
 * the release — composed, not re-derived: every order it keeps is pinned by
 * `src/host/{turnGuards,sendStream,historyWrite}.ts` and their tests (D2
 * rows 1, 3, 4, 5, 6, 11).
 *
 * What is NOT here (reported): the bench-command branch and the doc-hint
 * composition (attachments are held in this slice), the voice/PDF/translate
 * busy guards (those systems are not mounted), the chat-side pre-send fit
 * gate (the load path runs the same gate), the OS thermal gate (it arrives
 * as the `tooHot` composer phase), and the notes-truncation `onNotice`
 * (absent, D1 row 40), which the engine half treats as optional.
 */
import { useRef } from "react";
import { hasDeepResearchTrigger, stripDeepResearchTrigger } from "../research/plan";
import { createStreamCoalescer } from "../engine/streamCoalescer";
import {
  regenHandleSendPassRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import type { HistoryWriteTicket } from "../chat/historyWriteGuard";
import { classifyChatContent } from "../domain/contentFilter";
import { runSendStream, type SendEngine, type SendUiHandlers } from "./sendStream";
import { armsSendOptions } from "./composerArms";
import { contentFilterMessage } from "./contentFilterCopy";
import { handleSendStream } from "./engineTurn";
import type { EngineTurnCallbacks, EngineTurnDeps } from "./engineTurnDeps";
import { createRichCallbacks } from "./sendCallbacks";
import { finalizeAssistantTurn } from "./sendFinalize";
import { handleStop, type StopDeps } from "./sendStop";
import { nextMsgId, type Message } from "./hostMessage";
import type { TranslateFn } from "../i18n";
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
  /** The composer's one-shot research/notes arms (D1 row 14): read through
   *  the refs at send time and cleared at the controller's own point —
   *  after the content gate. */
  arms: {
    researchRef: { current: boolean };
    notesRef: { current: boolean };
    clear: () => void;
  };
}

export interface SendHost {
  send: (text: string) => Promise<void>;
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

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    // The synchronous claim check (old controller minus the voice / PDF /
    // translate busy flags this host does not have): empty draft, claim or
    // sending already held, history not settled.
    if (
      !trimmed ||
      sendClaimRef.current ||
      sendingRef.current ||
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
            { id: userMsgId, role: "user", text: trimmed, createdAt: now },
            {
              id: assistantId,
              role: "assistant",
              text: contentFilterMessage(classification.reason, t),
              streaming: false,
              createdAt: now + 1,
            },
          ]),
        );
        params.clearDraft();
        return;
      }

      const useResearch = hasDeepResearchTrigger(trimmed);
      // The one-shot arms: captured AND cleared after the gate, before the
      // append — a keyword-only research send still clears an armed notes
      // mode, as the controller did.
      const armsOptions = armsSendOptions(
        params.arms.researchRef.current,
        params.arms.notesRef.current,
        useResearch,
      );
      if (params.arms.researchRef.current || params.arms.notesRef.current) {
        params.arms.clear();
      }
      const modelText = useResearch ? stripDeepResearchTrigger(trimmed) || trimmed : trimmed;

      params.setMessages((prev) =>
        fence.apply(token, prev, (state) => [
          ...state,
          { id: userMsgId, role: "user", text: trimmed, createdAt: now },
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
      params.clearDraft();

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
      // double-counted here.
      const engine: SendEngine = (request, emit, signal) =>
        handleSendStream(
          engineDeps,
          request.text,
          {
            ...rich.callbacks,
            onDelta: (delta, full) => emit.onDelta(delta, full),
            onFailed: (reasonKey) => emit.onFailed?.(reasonKey),
            // Sources ride the emit path so the run layer drops them after
            // the terminal result; the rich copy is not called twice.
            onSources: (sources) => emit.onSources?.(sources),
          } as EngineTurnCallbacks,
          signal,
          undefined,
          request.history as unknown[] | undefined,
          undefined,
          request.options
            ? {
                research: request.options.research,
                notes: request.options.notes,
                onNotice: request.options.onNotice,
              }
            : undefined,
        );
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
        history: params.messagesRef.current,
        // Research or armed notes hand the engine its options.
        options: armsOptions ?? undefined,
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
        const captured = rich.captured();
        const finalizeCtx = {
          fence,
          token,
          assistantId,
          messagesRef: params.messagesRef,
          setMessages: params.setMessages,
          persist: params.persist,
          getEpoch: params.getEpoch,
        };
        if (result.kind === "aborted") {
          // Stop before any token: remove the empty placeholder (no ghost bubble).
          params.setMessages((prev) =>
            fence.apply(token, prev, (state) =>
              state.filter((message) => message.id !== assistantId),
            ),
          );
        } else if (result.kind === "failed") {
          // A backend that failed without a delta still gets honest text; a
          // ⚠️ delta already streamed is kept as-is. The message is MARKED
          // failed (§2.8) with the engine's own reason when one exists —
          // never a catalogued apology; an absent reason draws the reasonless
          // honest line instead.
          finalizeAssistantTurn(finalizeCtx, captured, {
            interrupted: false,
            fallbackText: t("chat.serviceUnreachable"),
            failure: {
              reason: captured.failureReason ?? result.message?.trim(),
              thermal: result.reasonKey === "chat.thermalHardGateBody",
            },
            afterSessionSave: result.afterSessionSave,
          });
        } else {
          // done | interrupted: the partial stays, marked interrupted when
          // stopped after tokens; the turn-end save and the extract release
          // run for both.
          finalizeAssistantTurn(finalizeCtx, captured, {
            interrupted: result.kind === "interrupted",
            afterSessionSave: result.afterSessionSave,
          });
        }
      }
    } finally {
      releaseOwned(token);
    }
  };

  const stop = () => {
    const stopDeps: StopDeps = {
      fence,
      abortRef,
      stopWatchdogRef,
      currentTokenRef,
      sendingRef,
      sendClaimRef: sendClaimRef as { current: boolean },
      sendingInFlightRef: sendingInFlightRef as { current: boolean },
      regenInFlightRef,
      regenHandleSendPassRef,
      stopRequestedRef,
      messagesRef: params.messagesRef,
      setMessages: params.setMessages,
      persist: params.persist,
      getEpoch: params.getEpoch,
      onSendingChange: params.onSendingChange,
    };
    handleStop(stopDeps);
  };

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
