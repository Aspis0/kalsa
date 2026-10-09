import type { ChatMessage } from "../lib/types";
import type { ChatErrorKind } from "../lib/chat";
import { useEffect, useState } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { useBrainState } from "../surfaces/useBrain";
import { useStickToBottom } from "../lib/stickToBottom";
import { Markdown } from "./Markdown";
import { MessageImages } from "./MessageImages";
import { MessageVideos } from "./MessageVideos";
import { ThoughtCloud } from "./ThoughtCloud";
import { ToolActivity } from "./ToolActivity";
import { MiniappView } from "./miniapp/MiniappView";
import "./Thread.css";

export interface FailedState {
  messageId: string;
  kind: ChatErrorKind;
}

interface ThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  /** One entry per message that failed; each row shows its own. */
  failures: Record<string, FailedState>;
  tails: Record<string, string>;
  onRetry: (messageId: string) => void;
  /** Starts the engine, for an answer that failed while it is off. */
  onTurnOn: () => void;
  /** A mini app widget's next state, into the run that drew it. */
  onMiniappState: (messageId: string, runId: string, state: Record<string, unknown>) => void;
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

/** The waiting face the chat shows while the answer has not begun: three
    quiet dots. The Room's live row wears the same. */
export function Thinking() {
  return (
    <span className="thinking" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** How long the dots stay alone before the sentence about reading appears:
    an answer that starts quickly must not flash a line that is already
    untrue. */
const WAITING_SENTENCE_MS = 3000;

/** The dots, and — after a few quiet seconds — the sentence that says Kalsa is
    still reading. The timer dies with the row, so a first token, a thought or
    Stop takes the sentence away with the dots. */
function WaitingRow({ text, spoken }: { text: string; spoken: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), WAITING_SENTENCE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <span className="waiting-row">
        <Thinking />
        {slow ? (
          <span className="row-note" role="status">
            {text}
          </span>
        ) : null}
      </span>
      <span className="visually-hidden">{spoken}</span>
    </>
  );
}

/** The moment a message was said, in the reader's own language. */
export function stamp(when: number, tag: string): string {
  try {
    return new Intl.DateTimeFormat(tag).format(when);
  } catch {
    return "";
  }
}

function AssistantRow({
  message,
  streaming,
  failures,
  tail,
  onRetry,
  onTurnOn,
  onMiniappState,
}: {
  message: ChatMessage;
  streaming: boolean;
  failures: Record<string, FailedState>;
  tail?: string;
  onRetry: (messageId: string) => void;
  onTurnOn: () => void;
  onMiniappState: (messageId: string, runId: string, state: Record<string, unknown>) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.thread;
  const failedHere: FailedState | null = failures[message.id] ?? null;
  const brain = useBrainState();
  // The states Home's start acts on. While stopping, that path would stop the
  // engine again, so no button is offered then.
  const engineOff = brain?.kind === "stopped" || brain?.kind === "failed";
  const engineStopping = brain?.kind === "stopping";
  // With the engine off, a retry would only fail again: the button starts it
  // (the same start as Home) and the retry comes once it is on.
  const failure = failedHere !== null ? errorCopy(t, failedHere.kind) : null;
  const retry = engineOff
    ? { label: t.turnKalsaOn, run: onTurnOn }
    : { label: t.tryAgain, run: () => onRetry(message.id) };
  const hasReasoning = (message.reasoning ?? "") !== "";
  const toolRuns = message.toolRuns ?? [];
  const toolWorking = toolRuns.some((run) => run.state === "running");
  // Dots only when nothing has arrived at all: reasoning, once present, is the
  // waiting face, and a running tool says what it is doing.
  const showThinking =
    streaming && message.content.length === 0 && !hasReasoning && failedHere === null && !toolWorking;
  const showNoAnswer =
    hasReasoning && message.content === "" && !streaming && failedHere === null && !message.stopped;
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
        {toolRuns.map((run) =>
          run.miniapp ? (
            <MiniappView
              key={run.id}
              miniapp={run.miniapp}
              onState={(state) => onMiniappState(message.id, run.id, state)}
            />
          ) : null,
        )}
        {showThinking ? (
          <WaitingRow text={t.readingMessage} spoken={t.waitingFirstWord} />
        ) : message.content ? (
          <Markdown text={message.content} streaming={streaming} />
        ) : null}
        {message.stopped && failedHere === null ? (
          <p className="row-note">{t.stoppedEarly}</p>
        ) : null}
        {showNoAnswer ? (
          <div className="no-answer">
            <p>{engineOff ? t.engineOffBody : t.noAnswer}</p>
            {engineStopping ? null : (
              <button type="button" className="btn-quiet" onClick={retry.run}>
                {retry.label}
              </button>
            )}
          </div>
        ) : null}
        {failure !== null ? (
          <div className="error-block" role="alert">
            <p className="error-title">{failure.title}</p>
            <p className="error-body">{engineOff ? t.engineOffBody : failure.body}</p>
            <div className="error-actions">
              {engineStopping ? null : (
                <button type="button" className="btn-primary" onClick={retry.run}>
                  {retry.label}
                </button>
              )}
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
  failures,
  tails,
  onRetry,
  onTurnOn,
  onMiniappState,
}: ThreadProps) {
  const { table, tag } = useLanguage();
  const { ref: scrollRef, following, toBottom } = useStickToBottom();

  return (
    <div className="thread-wrap">
      <div
        ref={scrollRef}
        className="thread"
        aria-busy={streaming}
        aria-label={table.thread.threadAria}
      >
        <div className="thread-column">
          {messages.map((message) =>
            message.role === "user" ? (
              <div className="row row-user" key={message.id} title={stamp(message.createdAt, tag)}>
              <div className="user-bubble" data-message-id={message.id}>
                <MessageImages images={message.images} />
                <MessageVideos videos={message.videos} />
                {message.content}
              </div>
              </div>
            ) : (
              <AssistantRow
                key={message.id}
                message={message}
                streaming={streaming}
                failures={failures}
                tail={tails[message.id]}
                onRetry={onRetry}
                onTurnOn={onTurnOn}
                onMiniappState={onMiniappState}
              />
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
