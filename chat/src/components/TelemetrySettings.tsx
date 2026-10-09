import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { telemetryStatus, setTelemetry } from "../lib/telemetry";

export function TelemetrySettings() {
  const { table } = useLanguage();
  const t = table.telemetry;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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

  return <div className="settings-toggle">
    <label>
      <input type="checkbox" checked={enabled === true} disabled={enabled === null || busy} onChange={e => void change(e.target.checked)} />
      <span>{t.title}</span>
    </label>
    <p className="settings-note">{t.note}</p>
    {failed ? <p role="alert" className="settings-note">{t.failed}</p> : null}
  </div>;
}
