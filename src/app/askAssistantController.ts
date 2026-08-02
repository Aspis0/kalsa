import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appendAskAssistantQuickAction,
  createAskAssistantBlockedDraft,
  createAskAssistantDraftStream,
  createAskAssistantOpeningMessage,
  getAskAssistantContext,
  updateAskAssistantStreamingMessage,
  type AskAssistantMessage,
  type AskAssistantMiniapp,
  type AskAssistantQuickAction,
  type AskAssistantSource,
} from "../domain/askAssistant";
import { classifyChatContent } from "../domain/contentFilter";
import { streamAssistantTurn, type EngineTurnOptions } from "../engine/LlamaService";

/**
 * Macchina a stati "Ask AI" estratta dal monolite App.tsx originale.
 * Bio-specifico rimosso: quick action, streaming e miniapp sono generici.
 * `options` (tool/websearch) passati al turno engine; aggiornati via ref per
 * non ricreare la callback a ogni render.
 */
export function useAskAssistantController(options?: EngineTurnOptions) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AskAssistantMessage[]>([]);
  const [draft, setDraft] = useState("");

  const optionsRef = useRef<EngineTurnOptions | undefined>(options);
  optionsRef.current = options;

  const context = useMemo(() => getAskAssistantContext({}), []);

  const streamingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortController = useRef<AbortController | null>(null);
  const streamRunId = useRef(0);

  const clearStreamingTimers = useCallback(() => {
    streamRunId.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    streamingTimers.current.forEach((timer) => clearTimeout(timer));
    streamingTimers.current = [];
  }, []);

  useEffect(() => {
    return () => clearStreamingTimers();
  }, [clearStreamingTimers]);

  const toggleOpen = useCallback(() => {
    setMessages((current) =>
      current.length ? current : [createAskAssistantOpeningMessage(context)],
    );
    setOpen((current) => !current);
  }, [context]);

  const close = useCallback(() => {
    clearStreamingTimers();
    setOpen(false);
  }, [clearStreamingTimers]);

  const runQuickAction = useCallback(
    (action: AskAssistantQuickAction) => {
      clearStreamingTimers();
      setMessages((current) => appendAskAssistantQuickAction(current, action));
    },
    [clearStreamingTimers],
  );

  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (messages.some((message) => message.status === "thinking" || message.status === "streaming")) return;
    clearStreamingTimers();

    const filterResult = classifyChatContent(text);
    if (!filterResult.shouldCallProvider) {
      setMessages((current) => createAskAssistantBlockedDraft(current, text, filterResult));
      setDraft("");
      return;
    }

    const stream = createAskAssistantDraftStream(messages, text);
    const runId = streamRunId.current;
    const controller = new AbortController();
    abortController.current = controller;
    setMessages(stream.messages);
    setDraft("");

    let streamedAnswer = "";
    const thinkingTimer = setTimeout(() => {
      streamAssistantTurn(
        [{ role: "user", content: text }],
        {
          onStatus: (status) => {
            if (runId !== streamRunId.current) return;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(
                current,
                stream.assistantMessageId,
                status.label || "Working...",
                "thinking",
              ),
            );
          },
          onDelta: (_delta, answer) => {
            if (runId !== streamRunId.current) return;
            streamedAnswer = answer;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(current, stream.assistantMessageId, answer, "streaming"),
            );
          },
          onMiniapp: (miniapp) => {
            if (runId !== streamRunId.current) return;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(current, stream.assistantMessageId, streamedAnswer, "streaming", {
                miniapp: miniapp as AskAssistantMiniapp,
              }),
            );
          },
          onSources: (sources) => {
            if (runId !== streamRunId.current) return;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(current, stream.assistantMessageId, streamedAnswer, "streaming", {
                sources: sources as AskAssistantSource[],
              }),
            );
          },
          onDone: () => {
            if (runId !== streamRunId.current) return;
            abortController.current = null;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(
                current,
                stream.assistantMessageId,
                streamedAnswer || stream.finalText,
                "done",
              ),
            );
          },
          onError: (error) => {
            if (runId !== streamRunId.current) return;
            abortController.current = null;
            setMessages((current) =>
              updateAskAssistantStreamingMessage(
                current,
                stream.assistantMessageId,
                error.message || stream.finalText,
                "done",
              ),
            );
          },
        },
        controller.signal,
        optionsRef.current,
      );
    }, 420);
    streamingTimers.current.push(thinkingTimer);
  }, [clearStreamingTimers, draft, messages]);

  return {
    close,
    context,
    draft,
    messages,
    open,
    runQuickAction,
    sendDraft,
    setDraft,
    toggleOpen,
  };
}
