import { useEffect, useId, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { telemetryStatus, setTelemetry } from "../lib/telemetry";
import { Icon } from "./Icon";

/** The error-report row and its note, rendered inside the page's card. */
export function TelemetrySettings() {
  const { table } = useLanguage();
  const t = table.telemetry;
  const titleId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void telemetryStatus().then(s => { if (live) setEnabled(s.enabled); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await setTelemetry(next);
      setEnabled(next);
    } catch {
      setFailed(true);
      try { setEnabled((await telemetryStatus()).enabled); } catch { setEnabled(null); }
    } finally { setBusy(false); }
  }

  return <>
    <div className="settings-row">
      <div className="settings-row-text">
        <span id={titleId} className="settings-row-title">{t.title}</span>
        <span className="settings-row-hint">{t.hint}</span>
        {failed ? <span role="alert" className="settings-err">{t.failed}</span> : null}
        <button type="button" className="settings-more" aria-expanded={noteOpen} onClick={() => setNoteOpen(open => !open)}>
          {t.more}
          <Icon name={noteOpen ? "down" : "right"} size={14} stroke={2.2} />
        </button>
      </div>
      <input
        type="checkbox"
        className="settings-switch"
        aria-labelledby={titleId}
        checked={enabled === true}
        disabled={enabled === null || busy}
        onChange={e => void change(e.target.checked)}
      />
    </div>
    {noteOpen ? <div className="settings-rownote"><p>{t.note}</p></div> : null}
  </>;
}
