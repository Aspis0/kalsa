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
  | { kind: "sent"; id: string }
  | { kind: "refused"; code: SendRefusal };

/** The privacy sentence and the Send button, shared by the three places a
    report can be asked for: the Advanced section, the crash prompt, and
    the webview's own error screen. `big` sets the sentence in the large
    type the owner asked for on the report section; the dialog shows it
    the same way. */
export function SendLogBlock({ words }: { words: English["report"] }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const send = useCallback(async () => {
    setState({ kind: "sending" });
    try {
      const id = await sendLog();
      setState({ kind: "sent", id });
    } catch (error) {
      const code = String(error).replace(/^"|"$/g, "");
      const refusal: SendRefusal =
        code === "rate_limited" || code === "try_tomorrow" || code === "offline" ? code : "failed";
      setState({ kind: "refused", code: refusal });
    }
  }, []);
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
      {state.kind === "sent" ? (
        // The number is the one thing the tester must be able to copy.
        <p className="report-sent" role="status">{words.sentWithId(state.id)}</p>
      ) : null}
      {state.kind === "refused" ? (
        <p className="report-error" role="alert">
          {state.code === "rate_limited"
            ? words.errRateLimited
            : state.code === "try_tomorrow"
              ? words.errTryTomorrow
              : words.errSend}
        </p>
      ) : null}
    </div>
  );
}

/** The Advanced surface's report section: the big privacy sentence, the
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
