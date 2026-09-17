import { useLayoutEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import type { ChatMessage } from "../lib/types";
import type { ChatErrorKind } from "../lib/chat";
import { Markdown } from "./Markdown";
import "./Thread.css";

export interface FailedState {
  messageId: string;
  kind: ChatErrorKind;
}

interface ThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  failed: FailedState | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}

function errorCopy(kind: ChatErrorKind): { title: string; body: string } {
  switch (kind) {
    case "unauthorized":
      return {
        title: "The server did not accept the key.",
        body: "It answered 401 — the token is missing, wrong, or expired. Check it in Settings and try again.",
      };
    case "network":
      return {
        title: "The server could not be reached.",
        body: "Check the address in Settings and that the server is running, then try again.",
      };
    default:
      return {
        title: "The server answered with an error.",
        body: "Nothing was lost — your message is above. Wait a moment and try again.",
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
  onRetry,
  onOpenSettings,
}: {
  message: ChatMessage;
  streaming: boolean;
  failed: FailedState | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const showThinking = streaming && message.content.length === 0 && !failed;
  return (
    <div className="row row-assistant" title={stamp(message.createdAt)}>
      <div className="assistant-body">
        {showThinking ? (
          <>
            <Thinking />
            <span className="visually-hidden">Waiting for the first word</span>
          </>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : null}
        {message.stopped && !failed ? (
          <p className="row-note">Stopped early — showing what arrived.</p>
        ) : null}
        {failed && failed.messageId === message.id ? (
          <div className="error-block" role="alert">
            <p className="error-title">{errorCopy(failed.kind).title}</p>
            <p className="error-body">{errorCopy(failed.kind).body}</p>
            <div className="error-actions">
              <button type="button" className="btn-primary" onClick={onRetry}>
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

export function Thread({ messages, streaming, failed, onRetry, onOpenSettings }: ThreadProps) {
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
                <div className="user-bubble">{message.content}</div>
              </div>
            ) : (
              <AssistantRow
                key={message.id}
                message={message}
                streaming={streaming}
                failed={failed}
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
