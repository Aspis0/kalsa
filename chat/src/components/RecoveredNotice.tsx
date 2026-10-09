import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { telemetryStatus } from "../lib/telemetry";
import "./RecoveredNotice.css";

/** How long the line stays before it leaves by itself. */
const SHOW_MS = 6000;
// A status that never answers must not hide the line: past this bound it is
// drawn as if error reports were off, until the real answer replaces that.
const DECIDE_BOUND_MS = 300;

/** One discreet line after Kalsa restarted its engine by itself. With error
    reports off nothing has gone out, so the line offers the manual send. */
export function RecoveredNotice({ onSendLog, onDismiss }: { onSendLog: () => void; onDismiss: () => void }) {
  const { table } = useLanguage();
  const words = table.report;
  // null until the telemetry state is known, so the link does not flash in and out.
  const [autoReport, setAutoReport] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const bound = setTimeout(() => {
      if (live) setAutoReport((known) => known ?? false);
    }, DECIDE_BOUND_MS);
    telemetryStatus()
      .then((s) => {
        if (live) setAutoReport(s.enabled);
      })
      .catch(() => {
        if (live) setAutoReport((known) => known ?? false);
      })
      .finally(() => clearTimeout(bound));
    return () => { live = false; clearTimeout(bound); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (autoReport === null) return null;
  return (
    <div className="recovered-note" role="status">
      <span>{words.recovered}</span>
      {autoReport ? null : (
        <button
          type="button"
          className="recovered-link"
          onClick={() => {
            onSendLog();
            onDismiss();
          }}
        >
          {words.send}
        </button>
      )}
      <button type="button" className="recovered-dismiss" onClick={onDismiss}>
        {table.shell.dismiss}
      </button>
    </div>
  );
}
