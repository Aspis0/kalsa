import { useLanguage } from "../i18n/useLanguage";
import { SendLogBlock } from "./ReportProblem";
import type { CrashAsk } from "../surfaces/useCrashAsk";
import "./ReportProblem.css";

/** The crash prompt: one card, one question, asked when the previous
    session did not close normally or when the engine died under a running
    app. The two triggers say their own title — the unclean exit is a
    shutdown that did not finish, the engine death is something that went
    wrong right now — and share everything else. "Not now" closes it for
    the rest of the session; nothing is ever sent without the press. */
export function CrashDialog({ ask, onClose }: { ask: CrashAsk; onClose: () => void }) {
  const { table } = useLanguage();
  const words = table.report;
  return (
    <div
      className="crash-card"
      role="alertdialog"
      aria-label={ask === "unclean" ? words.crashUncleanTitle : words.crashTitle}
    >
      <h2>{ask === "unclean" ? words.crashUncleanTitle : words.crashTitle}</h2>
      {ask === "unclean" ? <p className="crash-body">{words.crashUncleanBody}</p> : null}
      <SendLogBlock words={words} />
      <div className="surface-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>
          {words.notNow}
        </button>
      </div>
    </div>
  );
}
