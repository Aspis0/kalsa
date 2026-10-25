import { useCallback, useState } from "react";
import { available, invoke } from "../lib/tauri";
import { sendLog, type SendRefusal } from "../lib/report";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import { Icon } from "./Icon";
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

/** Help draws the report with the primary Send and the log folder; the crash
    screen draws Send outlined, because Reload is its one primary action. */
export type ReportVariant = "help" | "crash";

/** The report card the Help page and the crash screen share: the heading, the
    privacy sentence with its lock, what the log holds, then the actions. A
    refused send leaves its reason in place of the folder button. */
export function ReportCard({ words, variant }: { words: English["report"]; variant: ReportVariant }) {
  const { state, send } = useSendLog();
  const [openFailed, setOpenFailed] = useState(false);
  const help = variant === "help";
  async function open(): Promise<void> {
    try {
      await invoke("brain_open_log_folder");
      setOpenFailed(false);
    } catch {
      setOpenFailed(true);
    }
  }
  return (
    <section className="report-card">
      <h3 className="report-title">{words.title}</h3>
      <p className="report-privacy">
        <Icon name="lock" size={20} />
        {words.privacy}
      </p>
      <p className="report-facts">{words.facts}</p>
      <div className="report-actions">
        {state.kind === "sent" ? (
          <p className="report-sent" role="status">
            <Icon name="check" size={19} stroke={2.6} />
            {words.sent}
          </p>
        ) : (
          <button
            type="button"
            className={help ? "report-btn report-btn-primary" : "report-btn"}
            disabled={state.kind === "sending"}
            onClick={() => void send()}
          >
            <Icon name="send" size={18} />
            {state.kind === "sending" ? words.sending : words.send}
          </button>
        )}
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
        {help && state.kind !== "refused" ? (
          <button type="button" className="report-btn" onClick={() => void open()}>
            <Icon name="folder" size={18} />
            {words.open}
          </button>
        ) : null}
        {help && openFailed ? <p className="report-error">{words.openFailed}</p> : null}
      </div>
    </section>
  );
}

/** Help's report section, drawn only where the app can reach its log. */
export function ReportProblem() {
  const { table } = useLanguage();
  if (!available()) return null;
  return <ReportCard words={table.report} variant="help" />;
}
