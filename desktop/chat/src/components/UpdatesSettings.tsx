import { useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import type { UpdatesApi } from "../lib/useUpdates";
import { Icon } from "./Icon";
import { ReleaseNotes } from "./ReleaseNotes";
import { UpdateFailure } from "./UpdateFailure";

interface UpdatesSettingsProps {
  updates: UpdatesApi;
  /** A reply is being written: the install waits for it. */
  busy: boolean;
}

export function UpdatesSettings({ updates, busy }: UpdatesSettingsProps) {
  const { table } = useLanguage();
  const t = table.updates;
  const [notesOpen, setNotesOpen] = useState(false);
  const { state } = updates;
  const phase = state.phase;
  const checking = phase.kind === "checking";
  const downloading = phase.kind === "downloading";
  // A refused install keeps its release on the page, so it can be pressed again.
  const retry = phase.kind === "failed" ? phase.version : null;
  const percent =
    phase.kind === "downloading" && phase.total ? Math.min(100, Math.floor((phase.done * 100) / phase.total)) : null;

  return <>
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{`${t.currentVersion} ${state.current ?? ""}`.trim()}</span>
        {phase.kind === "current"
          ? <span className="settings-ok"><Icon name="check" size={15} stroke={2.6} />{t.upToDate}</span>
          : <span className="settings-row-hint">{t.note}</span>}
      </div>
      <button type="button" className="settings-btn" disabled={checking || downloading} onClick={updates.check}>
        {checking ? <span className="settings-spin" aria-hidden="true" /> : <Icon name="refresh" size={17} />}
        {checking ? t.checking : t.check}
      </button>
    </div>
    {phase.kind === "available" ? <div className="settings-update">
      <b className="settings-update-title">{t.available(phase.version)}</b>
      <button type="button" className="settings-more" aria-expanded={notesOpen} onClick={() => setNotesOpen(open => !open)}>
        {t.whatsNew}
        <Icon name={notesOpen ? "down" : "right"} size={15} stroke={2.2} />
      </button>
      {notesOpen ? <ReleaseNotes notes={phase.notes} /> : null}
      <div className="settings-update-actions">
        <button type="button" className="settings-btn is-primary" disabled={busy} onClick={() => updates.install(phase.version)}>
          <Icon name="refresh" size={17} />
          {t.install}
        </button>
        {busy ? <span className="settings-update-busy">{t.busy}</span> : null}
      </div>
    </div> : null}
    {phase.kind === "downloading" ? <div className="settings-update">
      <b className="settings-update-title">{t.downloading(percent)}</b>
      <progress className="settings-progress" value={phase.total ? phase.done : undefined} max={phase.total ?? undefined} />
    </div> : null}
    {phase.kind === "failed" ? <div className="settings-update is-failed">
      <UpdateFailure error={phase.error} className="settings-update-title" />
      {retry ? <div className="settings-update-actions">
        <button type="button" className="settings-btn is-primary" disabled={busy} onClick={() => updates.install(retry)}>
          <Icon name="refresh" size={17} />
          {t.install}
        </button>
      </div> : null}
    </div> : null}
  </>;
}
