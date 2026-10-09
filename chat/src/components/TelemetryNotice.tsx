import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { telemetryStatus, dismissTelemetryNotice } from "../lib/telemetry";

export function TelemetryNotice() {
  const { table } = useLanguage();
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void telemetryStatus().then(s => { if (live) setShown(!s.noticeSeen); }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function dismiss() {
    try { await dismissTelemetryNotice(); setShown(false); }
    catch { setFailed(true); }
  }
  if (!shown) return null;
  return <div className="refusal-banner" role="status">
    <span>{table.telemetry.notice}{failed ? ` ${table.telemetry.failed}` : ""}</span>
    <button type="button" onClick={() => void dismiss()}>{table.shell.dismiss}</button>
  </div>;
}
