import { useLanguage } from "../i18n/useLanguage";
import { rustSentence } from "../lib/rustText";
import type { UpdatesApi } from "../lib/useUpdates";

interface UpdatesSettingsProps {
  updates: UpdatesApi;
  /** A reply is being written: the install waits for it. */
  busy: boolean;
}

export function UpdatesSettings({ updates, busy }: UpdatesSettingsProps) {
  const { table, tag } = useLanguage();
  const t = table.updates;
  const { state } = updates;
  const phase = state.phase;
  const checking = phase.kind === "checking";
  const downloading = phase.kind === "downloading";
  // A refused install keeps its release on the page, so it can be pressed again.
  const retry = phase.kind === "failed" ? phase.version : null;
  const percent =
    phase.kind === "downloading" && phase.total ? Math.floor((phase.done * 100) / phase.total) : null;

  return <div className="settings-toggle">
    <p>{t.title}</p>
    <p className="settings-note">{`${t.currentVersion} ${state.current ?? ""}`.trim()}</p>
    <div className="settings-actions">
      <button type="button" className="btn-quiet" disabled={checking || downloading} onClick={updates.check}>
        {checking ? t.checking : t.check}
      </button>
    </div>
    {phase.kind === "current" ? <p>{t.upToDate}</p> : null}
    {phase.kind === "available" ? <>
      <p>{t.available(phase.version)}</p>
      <div className="settings-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => updates.install(phase.version)}>
          {t.install}
        </button>
      </div>
      {busy ? <p className="settings-note">{t.busy}</p> : null}
    </> : null}
    {phase.kind === "downloading" ? <>
      <p>{t.downloading(percent)}</p>
      <progress value={phase.total ? phase.done : undefined} max={phase.total ?? undefined} />
    </> : null}
    {phase.kind === "failed" ? <>
      <p role="alert" className="settings-note">{rustSentence(table.rust, phase.error, tag)}</p>
      {retry ? <div className="settings-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => updates.install(retry)}>
          {t.install}
        </button>
      </div> : null}
    </> : null}
    <p className="settings-note">{t.note}</p>
  </div>;
}
