import type { ChatMessage } from "../lib/types";
import type { ChatErrorKind } from "../lib/chat";
import { useEffect, useState } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { useBrainStateKind } from "../surfaces/useBrain";
import { useStickToBottom } from "../lib/stickToBottom";
import { Markdown } from "./Markdown";
import { MessageImages } from "./MessageImages";
import { MessageVideos } from "./MessageVideos";
import { ThoughtCloud } from "./ThoughtCloud";
import { MiniappRows, ToolActivity } from "./ToolActivity";
import { MailRows } from "./mail/MailRows";
import type { MailCardItem } from "../lib/mail/types";
import type { PendingSend } from "../lib/mail/pending";
import type { DraftRecord, Drafts, SentTo } from "../lib/mail/drafts";
import { MessageActions } from "./MessageActions";
import { Icon } from "./Icon";
import "./Thread.css";

export interface FailedState {
  messageId: string;
  kind: ChatErrorKind;
  /** When the turn failed; a failure read back from storage has none. */
  at?: number;
}

/** The newest turn the person sent: the thread follows it into place. */
function lastUser(messages: ChatMessage[]): string | null {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at].role === "user") return messages[at].id;
  }
  return null;
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
  /** The engine's last automatic restart, when the desktop announced one. */
  restartedAt: number | null;
  /** A mini app widget's next state, into the run that drew it. */
  onMiniappState: (messageId: string, runId: string, state: Record<string, unknown>) => void;
  /** A web call is held for the owner's OK, so the running check says so. */
  awaitingOk: boolean;
  /** The mail the Mail tab is showing, and what a card's buttons do. */
  mailOpen: string | null;
  onOpenMail: (item: MailCardItem) => void;
  onReplyMail: (item: MailCardItem) => void;
  onSendMail: (send: PendingSend) => void;
  mailSent: SentTo;
  mailDrafts: Drafts;
  onSaveMail: (replyToId: string, record: DraftRecord) => void;
  onComposeMail: (replyToId: string, body: string) => void;
  /** A failed mail call offers the account page, where its own fix lives. */
  onOpenMailSettings: () => void;
}

function errorCopy(
  t: English["thread"],
  kind: ChatErrorKind,
  engineLive: boolean,
): { title: string; body: string } {
  switch (kind) {
    case "unauthorized":
    case "bad-response":
      return { title: t.couldntAnswerTitle, body: t.couldntAnswerBody };
    case "network":
      // "Not running" is only true while the engine is down.
      return engineLive
        ? { title: t.tryAgainTitle, body: t.tryAgainBody }
        : { title: t.notRunningTitle, body: t.notRunningBody };
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

/** The restart is decided a second or two after the death, and the stream's
    failure follows the death by a read: the two may fall either side. */
const RESTART_WINDOW_MS = 30_000;

/** What a dead engine surfaces as: a cut after words arrived, a failed read
    before any, or a clean close with no words. An idle timeout is the engine
    going silent, and a status answer (401, 400, HTTP) means the engine was up. */
const DEATH_KINDS: ReadonlySet<ChatErrorKind> = new Set<ChatErrorKind>(["network", "truncated", "bad-response"]);

/** A failure the engine's own restart interrupted: the restart was announced
    after the turn began and within the window around the failure. */
function interruptedByRestart(failure: FailedState, turnStart: number, restartedAt: number | null): boolean {
  return (
    DEATH_KINDS.has(failure.kind) &&
    failure.at !== undefined &&
    restartedAt !== null &&
    restartedAt >= turnStart &&
    Math.abs(restartedAt - failure.at) <= RESTART_WINDOW_MS
  );
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
  live,
  failures,
  tail,
  onRetry,
  onTurnOn,
  restartedAt,
  onMiniappState,
  awaitingOk,
  mailOpen,
  onOpenMail,
  onReplyMail,
  onSendMail,
  mailSent,
  mailDrafts,
  onSaveMail,
  onComposeMail,
  onOpenMailSettings,
}: {
  message: ChatMessage;
  streaming: boolean;
  /** This is the answer being written right now. */
  live: boolean;
  failures: Record<string, FailedState>;
  tail?: string;
  onRetry: (messageId: string) => void;
  onTurnOn: () => void;
  restartedAt: number | null;
  onMiniappState: (messageId: string, runId: string, state: Record<string, unknown>) => void;
  awaitingOk: boolean;
  mailOpen: string | null;
  onOpenMail: (item: MailCardItem) => void;
  onReplyMail: (item: MailCardItem) => void;
  onSendMail: (send: PendingSend) => void;
  mailSent: SentTo;
  mailDrafts: Drafts;
  onSaveMail: (replyToId: string, record: DraftRecord) => void;
  onComposeMail: (replyToId: string, body: string) => void;
  onOpenMailSettings: () => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.thread;
  const failedHere: FailedState | null = failures[message.id] ?? null;
  const brainKind = useBrainStateKind();
  // The states Home's start acts on. While stopping, that path would stop the
  // engine again, so no button is offered then.
  const engineOff = brainKind === "stopped" || brainKind === "failed";
  const engineLive = brainKind === "starting" || brainKind === "running";
  const engineStopping = brainKind === "stopping";
  const interrupted =
    failedHere !== null && engineLive && interruptedByRestart(failedHere, message.createdAt, restartedAt);
  const failure = failedHere !== null ? errorCopy(t, failedHere.kind, engineLive) : null;
  // With the engine off, a retry would only fail again: the button starts it
  // (the same start as Home) and the retry comes once it is on.
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
  // The copy and time row only under an answer that is done and whole.
  const finished = !live && message.content !== "" && failedHere === null && !interrupted;
  return (
    <div className="row row-assistant" title={stamp(message.createdAt, tag)}>
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
      <MiniappRows runs={toolRuns} onState={(runId, state) => onMiniappState(message.id, runId, state)} />
      <div className="assistant-bubble">
        <ToolActivity runs={toolRuns} awaitingOk={awaitingOk} />
        {showThinking ? (
          <WaitingRow text={t.readingMessage} spoken={t.waitingFirstWord} />
        ) : message.content ? (
          <Markdown text={message.content} streaming={streaming} />
        ) : null}
        {/* The cards follow the sentence that introduces them: what Kalsa
            found, then the mail itself. */}
        <MailRows
        runs={toolRuns}
        selected={mailOpen}
        onOpen={onOpenMail}
        onDraft={onReplyMail}
        onSend={onSendMail}
        sent={mailSent}
        drafts={mailDrafts}
        onSave={onSaveMail}
        onComposeMail={onComposeMail}
        onOpenMailSettings={onOpenMailSettings}
      />
        {message.stopped && failedHere === null ? <p className="row-note">{t.stoppedEarly}</p> : null}
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
        {interrupted ? (
          <p className="row-note interrupted-note">
            <span>{t.interruptedNote}</span>
            <button type="button" className="interrupted-retry" onClick={() => onRetry(message.id)}>
              {t.interruptedRetry}
            </button>
          </p>
        ) : failure !== null ? (
          <div className="error-block" role="alert">
            <span className="error-icon" aria-hidden="true">
              <Icon name={engineOff ? "power" : "alert"} size={19} />
            </span>
            <div>
              <p className="error-title">{failure.title}</p>
              <p className="error-body">{engineOff ? t.engineOffBody : failure.body}</p>
              {engineStopping ? null : (
                <button type="button" className={engineOff ? "btn-primary" : "btn-quiet"} onClick={retry.run}>
                  <Icon name={engineOff ? "power" : "refresh"} size={18} />
                  {retry.label}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {finished ? <MessageActions text={message.content} at={message.createdAt} /> : null}
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
  restartedAt,
  onMiniappState,
  awaitingOk,
  mailOpen,
  onOpenMail,
  onReplyMail,
  onSendMail,
  mailSent,
  mailDrafts,
  onSaveMail,
  onComposeMail,
  onOpenMailSettings,
}: ThreadProps) {
  const { table, tag } = useLanguage();
  const { ref: scrollRef, following, toBottom } = useStickToBottom();
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
  // Sending brings the thread back to the end: the person asked something and
  // reads the answer where they asked it, not by hunting up for it.
  const asked = lastUser(messages);
  useEffect(() => {
    if (asked !== null) toBottom();
  }, [asked, toBottom]);

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
                {/* The pictures stand above the words, outside the bubble (11-chat-states-media). */}
                <MessageImages images={message.images} />
                <MessageVideos videos={message.videos} />
                {message.content ? <div className="user-bubble">{message.content}</div> : null}
                {message.mailSubject ? <p className="row-mail-subject">{message.mailSubject}</p> : null}
              </div>
            ) : (
              <AssistantRow
                key={message.id}
                message={message}
                streaming={streaming}
                live={streaming && message.id === lastId}
                failures={failures}
                tail={tails[message.id]}
                onRetry={onRetry}
                onTurnOn={onTurnOn}
                restartedAt={restartedAt}
                onMiniappState={onMiniappState}
                awaitingOk={awaitingOk}
                mailOpen={mailOpen}
                onOpenMail={onOpenMail}
                onReplyMail={onReplyMail}
                onSendMail={onSendMail}
                mailSent={mailSent}
                mailDrafts={mailDrafts}
                onSaveMail={onSaveMail}
                onComposeMail={onComposeMail}
                onOpenMailSettings={onOpenMailSettings}
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
