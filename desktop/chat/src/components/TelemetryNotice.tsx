import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { telemetryStatus, dismissTelemetryNotice } from "../lib/telemetry";
import { Icon } from "./Icon";
import "./NoticeBanner.css";

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
  return <div className="notice-banner" role="status">
    <span className="notice-banner-icon"><Icon name="shield" size={20} /></span>
    <div className="notice-banner-text">
      <b>{table.telemetry.noticeTitle}</b>
      <span>{table.telemetry.notice}{failed ? ` ${table.telemetry.failed}` : ""}</span>
    </div>
    <button type="button" className="notice-banner-btn" onClick={() => void dismiss()}>{table.shell.dismiss}</button>
  </div>;
}
