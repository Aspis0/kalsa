import { useLayoutEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { ChatMessage } from "../lib/types";
import type { ChatErrorKind } from "../lib/chat";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { Markdown } from "./Markdown";
import { ThoughtCloud } from "./ThoughtCloud";
import { ToolActivity } from "./ToolActivity";
import "./Thread.css";

export interface FailedState {
  messageId: string;
  kind: ChatErrorKind;
}

interface ThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  failed: FailedState | null;
  tails: Record<string, string>;
  onRetry: (messageId: string) => void;
}

function errorCopy(t: English["thread"], kind: ChatErrorKind): { title: string; body: string } {
  switch (kind) {
    case "unauthorized":
    case "bad-response":
      return { title: t.couldntAnswerTitle, body: t.couldntAnswerBody };
    case "network":
      return { title: t.notRunningTitle, body: t.notRunningBody };
    case "truncated":
      return { title: t.stoppedHalfwayTitle, body: t.stoppedHalfwayBody };
    case "timeout":
      return { title: t.stoppedTitle, body: t.stoppedBody };
    case "oversize":
      return { title: t.tooMuchTitle, body: t.tooMuchBody };
    default:
      return { title: t.tryAgainTitle, body: t.tryAgainBody };
  }
}

function Thinking() {
  return (
    <span className="thinking" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function stamp(when: number, tag: string): string {
  try {
    return new Intl.DateTimeFormat(tag).format(when);
  } catch {
    return "";
  }
}

function AssistantRow({
  message,
  streaming,
  failed,
  tail,
  onRetry,
}: {
  message: ChatMessage;
  streaming: boolean;
  failed: FailedState | null;
  tail?: string;
  onRetry: (messageId: string) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.thread;
  const failedHere = failed !== null && failed.messageId === message.id;
  const hasReasoning = (message.reasoning ?? "") !== "";
  const toolRuns = message.toolRuns ?? [];
  const toolWorking = toolRuns.some((run) => run.state === "running");
  // Dots only when nothing has arrived at all: reasoning, once present, is the
  // waiting face, and a running tool says what it is doing.
  const showThinking =
    streaming && message.content.length === 0 && !hasReasoning && !failedHere && !toolWorking;
  const showNoAnswer =
    hasReasoning && message.content === "" && !streaming && !failedHere && !message.stopped;
  return (
    <div className="row row-assistant" title={stamp(message.createdAt, tag)}>
      <div className="assistant-body">
        {hasReasoning ? (
          <ThoughtCloud
            messageId={message.id}
            reasoning={message.reasoning ?? ""}
            reasoningMs={message.reasoningMs}
            working={streaming && message.content === ""}
            answered={message.content !== ""}
            tail={tail}
          />
        ) : null}
        <ToolActivity runs={toolRuns} />
        {showThinking ? (
          <>
            <Thinking />
            <span className="visually-hidden">{t.waitingFirstWord}</span>
          </>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : null}
        {message.stopped && !failedHere ? (
          <p className="row-note">{t.stoppedEarly}</p>
        ) : null}
        {showNoAnswer ? (
          <div className="no-answer">
            <p>{t.noAnswer}</p>
            <button type="button" className="btn-quiet" onClick={() => onRetry(message.id)}>
              {t.tryAgain}
            </button>
          </div>
        ) : null}
        {failedHere ? (
          <div className="error-block" role="alert">
            <p className="error-title">{errorCopy(t, failed.kind).title}</p>
            <p className="error-body">{errorCopy(t, failed.kind).body}</p>
            <div className="error-actions">
              <button type="button" className="btn-primary" onClick={() => onRetry(message.id)}>
                {t.tryAgain}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Thread({
  messages,
  streaming,
  failed,
  tails,
  onRetry,
}: ThreadProps) {
  const { table, tag } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  // Stay glued to the bottom while responses arrive — unless the reader
  // scrolled up, in which case hold position and offer a way back.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  });

  function jumpToBottom(): void {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setPinned(true);
    }
  }

  return (
    <div className="thread-wrap">
      <div
        ref={scrollRef}
        className="thread"
        onScroll={handleScroll}
        aria-busy={streaming}
        aria-label={table.thread.threadAria}
      >
        <div className="thread-column">
          {messages.map((message) =>
            message.role === "user" ? (
              <div className="row row-user" key={message.id} title={stamp(message.createdAt, tag)}>
                <div className="user-bubble" data-message-id={message.id}>
                  {message.content}
                </div>
              </div>
            ) : (
              <AssistantRow
                key={message.id}
                message={message}
                streaming={streaming}
                failed={failed}
                tail={tails[message.id]}
                onRetry={onRetry}
              />
            ),
          )}
        </div>
      </div>
      {!pinned ? (
        <button type="button" className="jump-bottom" onClick={jumpToBottom}>
          {table.thread.backToLatest}
        </button>
      ) : null}
    </div>
  );
}
