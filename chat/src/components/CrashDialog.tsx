import { useLanguage } from "../i18n/useLanguage";
import { SendLogBlock } from "./ReportProblem";
import "./ReportProblem.css";

/** The crash prompt: one card, one question. Shown when the previous
    session exited uncleanly or the engine died under a running app — the
    two crashes a tester cannot report any other way. "Not now" closes it;
    nothing is ever sent without the press. */
export function CrashDialog({ onClose }: { onClose: () => void }) {
  const { table } = useLanguage();
  const words = table.report;
  return (
    <div className="crash-card" role="alertdialog" aria-label={words.crashTitle}>
      <h2>{words.crashTitle}</h2>
      <SendLogBlock words={words} />
      <div className="surface-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>
          {words.notNow}
        </button>
      </div>
    </div>
  );
}
