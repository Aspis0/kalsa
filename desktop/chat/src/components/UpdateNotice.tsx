import { useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import type { UpdatesApi } from "../lib/useUpdates";
import { Icon } from "./Icon";
import { ReleaseNotes } from "./ReleaseNotes";
import { UpdateFailure } from "./UpdateFailure";
import "./NoticeBanner.css";
import "./Settings.css";
import "./UpdateNotice.css";

interface UpdateNoticeProps {
  updates: UpdatesApi;
  /** A reply is being written: the install waits for it. */
  busy: boolean;
  /** Home draws the sheet over its empty bottom (mockup 05); every other page
      has a composer or content there, so it gets the banner at the top. */
  sheet: boolean;
}

/** What the startup check found. Nothing installs from it without the
    owner's button press; Later (or Escape, in the shell) puts it away. */
export function UpdateNotice({ updates, busy, sheet }: UpdateNoticeProps) {
  const { table } = useLanguage();
  const t = table.updates;
  // The sheet draws the notes open (05-update-notice); the banner keeps them
  // behind What's new, so it stays one line over the page.
  const [notesOpen, setNotesOpen] = useState(sheet);
  const { notice, phase } = updates.state;
  if (!notice) return null;
  const downloading = phase.kind === "downloading";
  const actions = (
    <>
      <button type="button" className={sheet ? "settings-btn" : "notice-banner-btn"} onClick={updates.dismissNotice}>
        {t.later}
      </button>
      <button type="button" className="settings-btn is-primary" disabled={busy || downloading} onClick={() => updates.install(notice.version)}>
        <Icon name="refresh" size={19} />
        {t.install}
      </button>
    </>
  );
  const words = (
    <>
      <b className="update-sheet-title">{t.ready}</b>
      {phase.kind === "failed" ? (
        <UpdateFailure error={phase.error} className="update-sheet-error" />
      ) : null}
      <button type="button" className="settings-more" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
        {t.whatsNew}
        <Icon name={notesOpen ? "down" : "right"} size={15} stroke={2.2} />
      </button>
      {notesOpen ? <ReleaseNotes notes={notice.notes} /> : null}
      {busy ? <span className="settings-update-busy">{t.busy}</span> : null}
    </>
  );
  if (!sheet) {
    return (
      <div className="notice-banner update-banner" role="status">
        <span className="notice-banner-icon">
          <Icon name="download" size={20} />
        </span>
        <div className="notice-banner-text">{words}</div>
        {actions}
      </div>
    );
  }
  return (
    <div className="update-sheet" role="status">
      <span className="update-sheet-icon">
        <Icon name="download" size={26} />
      </span>
      <div className="update-sheet-text">{words}</div>
      <div className="update-sheet-actions">{actions}</div>
    </div>
  );
}
