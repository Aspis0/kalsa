import type { ChatMessage } from "../lib/types";
import { useStickToBottom } from "../lib/stickToBottom";
import { useLanguage } from "../i18n/useLanguage";
import { Markdown } from "./Markdown";
import { MessageActions } from "./MessageActions";
import { Icon } from "./Icon";
import "./Thread.css";

/** The transcript. Reasoning stays as a plain disclosure — no animation, no
    cloud — and there are no tool cards until an engine can make tool calls. */
export function Thread({ messages }: { messages: ChatMessage[] }) {
  const { table, tag } = useLanguage();
  const { ref, following, toBottom } = useStickToBottom();
  return (
    <div className="thread-wrap">
      <div ref={ref} className="thread" aria-label={table.thread.threadAria}>
        <div className="thread-column">
          {messages.map((message) =>
            message.role === "user" ? (
              <div className="row row-user" key={message.id}>
                <div className="user-bubble">{message.content}</div>
              </div>
            ) : (
              <div className="row row-assistant" key={message.id}>
                {message.reasoning ? (
                  <details className="reasoning-block">
                    <summary>
                      <Icon name="thought" size={15} />
                      {table.thread.thinking}
                    </summary>
                    <div className="reasoning-text">{message.reasoning}</div>
                  </details>
                ) : null}
                <div className="assistant-bubble">
                  <Markdown text={message.content} />
                </div>
                <MessageActions text={message.content} at={message.createdAt} />
                <span className="visually-hidden">
                  {new Intl.DateTimeFormat(tag).format(message.createdAt)}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
      {!following ? (
        <button type="button" className="jump-bottom" onClick={toBottom}>
          {table.thread.backToLatest}
        </button>
      ) : null}
    </div>
  );
}
