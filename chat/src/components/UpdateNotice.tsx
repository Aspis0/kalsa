import { useLanguage } from "../i18n/useLanguage";
import { rustSentence } from "../lib/rustText";
import type { UpdatesApi } from "../lib/useUpdates";
import { ReleaseNotes } from "./ReleaseNotes";

interface UpdateNoticeProps {
  updates: UpdatesApi;
  /** A reply is being written: the install waits for it. */
  busy: boolean;
}

/** The small notice the startup check raises. Nothing installs from it
    without the owner's button press. */
export function UpdateNotice({ updates, busy }: UpdateNoticeProps) {
  const { table, tag } = useLanguage();
  const t = table.updates;
  const { notice, phase } = updates.state;
  if (!notice) return null;
  const downloading = phase.kind === "downloading";
  return <div className="refusal-banner" role="status">
    <div>
      <span>{t.ready(notice.version)}</span>
      <ReleaseNotes notes={notice.notes} />
    </div>
    {busy ? <span>{t.busy}</span> : null}
    {phase.kind === "failed" ? <span role="alert">{rustSentence(table.rust, phase.error, tag)}</span> : null}
    <button type="button" className="btn-primary" disabled={busy || downloading} onClick={() => updates.install(notice.version)}>
      {t.install}
    </button>
    <button type="button" onClick={updates.dismissNotice}>{table.shell.dismiss}</button>
  </div>;
}
