import { useCallback, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { sendLog, type SendRefusal } from "../lib/report";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import "./ReportProblem.css";

/** What one Send press is doing right now. */
type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "refused"; code: SendRefusal };

/** One Send press: its state and the action that makes it. */
function useSendLog(): { state: SendState; send: () => Promise<void> } {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const send = useCallback(async () => {
    setState({ kind: "sending" });
    try {
      await sendLog();
      setState({ kind: "sent" });
    } catch (error) {
      const code = String(error).replace(/^"|"$/g, "");
      const refusal: SendRefusal =
        code === "rate_limited" || code === "try_tomorrow" || code === "offline" ? code : "failed";
      setState({ kind: "refused", code: refusal });
    }
  }, []);
  return { state, send };
}

/** What a Send press leaves on screen: a thank-you, or why the log did not go. */
function SendFeedback({ state, words }: { state: SendState; words: English["report"] }) {
  return (
    <>
      {state.kind === "sent" ? (
        <p className="report-sent" role="status">{words.sent}</p>
      ) : null}
      {state.kind === "refused" ? (
        <p className="report-error" role="alert">
          {state.code === "rate_limited"
            ? words.errRateLimited
            : state.code === "try_tomorrow"
              ? words.errTryTomorrow
              : state.code === "offline"
                ? words.errUnreachable
                : words.errSend}
        </p>
      ) : null}
    </>
  );
}

/** The privacy sentence and the Send button, as the advanced panel and the
    webview's own error screen show them. */
export function SendLogBlock({ words }: { words: English["report"] }) {
  const { state, send } = useSendLog();
  return (
    <div className="report-send">
      <p className="report-privacy">{words.privacy}</p>
      <div className="surface-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={state.kind === "sending" || state.kind === "sent"}
          onClick={() => void send()}
        >
          {state.kind === "sending" ? words.sending : words.send}
        </button>
      </div>
      <SendFeedback state={state} words={words} />
    </div>
  );
}

/** The advanced panel's report section: the big privacy sentence, the
    one line of what the log does hold, Send (primary) and Open the log
    folder (secondary). */
export function ReportProblem() {
  const { table } = useLanguage();
  const words = table.report;
  const [openFailed, setOpenFailed] = useState(false);
  if (!available()) return null;
  async function open(): Promise<void> {
    try {
      await invoke("brain_open_log_folder");
      setOpenFailed(false);
    } catch {
      setOpenFailed(true);
    }
  }
  return (
    <section className="report-problem">
      <p className="report-eyebrow">{words.title.toUpperCase()}</p>
      <SendLogBlock words={words} />
      <p className="report-facts">{words.facts}</p>
      <div className="surface-actions">
        <button type="button" className="btn-quiet" onClick={() => void open()}>
          {words.open}
        </button>
      </div>
      {openFailed ? <p className="surface-note">{words.openFailed}</p> : null}
    </section>
  );
}
