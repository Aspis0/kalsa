import { useLanguage } from "../../i18n/useLanguage";
import { available } from "../../lib/tauri";
import { useConfirm } from "../../lib/browser/useConfirm";
import { Icon } from "../Icon";
import { ClearBrowserData } from "./ClearBrowserData";
import { DownloadDriver } from "./DownloadDriver";
import "../Settings.css";
import "./settingsBrowser.css";

/**
 * The browser's own page, reached from Settings by its row: the driver Kalsa
 * drives the browser with, and the one control over what that browser kept.
 *
 * It is here rather than on the first page because both of these cost the owner
 * something before they work — a 40 MB download, and a clear that cannot be
 * undone — and the first page is where the app promises that nothing leaves
 * the computer.
 */
export function BrowserSettingsPage({ onBack }: { onBack: () => void }) {
  const { table } = useLanguage();
  const t = table.driver;
  // The clear below reads the window from here rather than from the store of its
  // own: this page is already redrawn whenever the window opens or closes, and
  // that is the only moment its press changes.
  const { windowOpen } = useConfirm("");

  if (!available()) return null;

  return (
    <div className="settings-page">
      <h2>{t.title}</h2>
      <button type="button" className="browser-back" onClick={onBack}>
        <Icon name="left" size={16} stroke={2.2} />
        {t.back}
      </button>

      <div className="settings-group">
        <DownloadDriver />
        <ClearBrowserData open={windowOpen} />
      </div>
    </div>
  );
}