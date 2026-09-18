import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, UIEvent } from "react";
import type { ChatMessage } from "../lib/types";
import type { ChatErrorKind } from "../lib/chat";
import { Markdown } from "./Markdown";
import { ThoughtCloud } from "./ThoughtCloud";
import "./Thread.css";

export interface FailedState {
  messageId: string;
  kind: ChatErrorKind;
  status?: number;
  url?: string;
  detail?: string;
}

interface ThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  failed: FailedState | null;
  tails: Record<string, string>;
  onRetry: (messageId: string) => void;
  onOpenSettings: () => void;
  // The message the brain's writing bar became: it carries the transition
  // name for the one open move, then rides as an ordinary message.
  originMessageId?: string | null;
}

function errorCopy(kind: ChatErrorKind, status?: number): { title: string; body: string } {
  switch (kind) {
    case "unauthorized":
      return status === 403
        ? {
            title: "The server refused the key.",
            body: "It answered 403 — the key works but is not allowed here. Check it in Settings and try again.",
          }
        : {
            title: "The server did not accept the key.",
            body: "It answered 401 — the token is missing, wrong, or expired. Check it in Settings and try again.",
          };
    case "network":
      return {
        title: "The server could not be reached.",
        body: "Check the address in Settings and that the server is running, then try again.",
      };
    case "bad-response":
      return {
        title: "The server answered, but not as a chat stream.",
        body: "The reply was not event-stream data — this address may serve a web page or a different API. Check it in Settings and try again.",
      };
    case "truncated":
      return {
        title: "The answer stopped halfway.",
        body: "The connection closed before the end — what arrived is above. Try again for the full answer.",
      };
    case "timeout":
      return {
        title: "The server took too long to answer.",
        body: "A full minute with no new words, so the request was dropped. Try again.",
      };
    case "oversize":
      return {
        title: "This exceeds the context.",
        body: "Even without the older turns, this message plus its attachments don't fit. Remove a file or shorten the message.",
      };
    default:
      return {
        title: "The server answered with an error.",
        body: `It answered ${status ?? "with an error"}. Wait a moment and try again.`,
      };
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

function stamp(when: number): string {
  try {
    return new Date(when).toLocaleString();
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
  onOpenSettings,
}: {
  message: ChatMessage;
  streaming: boolean;
  failed: FailedState | null;
  tail?: string;
  onRetry: (messageId: string) => void;
  onOpenSettings: () => void;
}) {
  const failedHere = failed !== null && failed.messageId === message.id;
  const hasReasoning = (message.reasoning ?? "") !== "";
  // Dots only when nothing has arrived at all: reasoning, once present,
  // is the waiting face.
  const showThinking = streaming && message.content.length === 0 && !hasReasoning && !failedHere;
  const showNoAnswer =
    hasReasoning && message.content === "" && !streaming && !failedHere && !message.stopped;
  return (
    <div className="row row-assistant" title={stamp(message.createdAt)}>
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
        {showThinking ? (
          <>
            <Thinking />
            <span className="visually-hidden">Waiting for the first word</span>
          </>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : null}
        {message.stopped && !failedHere ? (
          <p className="row-note">Stopped early — showing what arrived.</p>
        ) : null}
        {showNoAnswer ? (
          <div className="no-answer">
            <p>The model thought but gave no answer.</p>
            <button type="button" className="btn-quiet" onClick={() => onRetry(message.id)}>
              Try again
            </button>
          </div>
        ) : null}
        {failedHere ? (
          <div className="error-block" role="alert">
            <p className="error-title">{errorCopy(failed.kind, failed.status).title}</p>
            <p className="error-body">{errorCopy(failed.kind, failed.status).body}</p>
            {failed.url ? <p className="error-url">Called: {failed.url}</p> : null}
            {failed.detail ? <p className="error-detail">{failed.detail}</p> : null}
            <div className="error-actions">
              <button type="button" className="btn-primary" onClick={() => onRetry(message.id)}>
                Try again
              </button>
              <button type="button" className="btn-quiet" onClick={onOpenSettings}>
                Open settings
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
  onOpenSettings,
  originMessageId,
}: ThreadProps) {
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
        aria-label="Conversation"
      >
        <div className="thread-column">
          {messages.map((message) =>
            message.role === "user" ? (
              <div className="row row-user" key={message.id} title={stamp(message.createdAt)}>
                <div
                  className="user-bubble"
                  style={
                    message.id === originMessageId
                      ? ({ viewTransitionName: "brain-bar" } as CSSProperties)
                      : undefined
                  }
                >
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
                onOpenSettings={onOpenSettings}
              />
            ),
          )}
        </div>
      </div>
      {!pinned ? (
        <button type="button" className="jump-bottom" onClick={jumpToBottom}>
          Back to latest ↓
        </button>
      ) : null}
    </div>
  );
}
