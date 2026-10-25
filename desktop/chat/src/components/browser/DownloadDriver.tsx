import { useLanguage } from "../../i18n/useLanguage";
import { canPress, percentOf, sizeLabel } from "../../lib/driverState";
import { Icon } from "../Icon";
import { useDriver } from "./useDriver";

/** The first press of the browser feature: an explicit download, its size, a
    bar while it runs, a sentence and a retry if it fails, and nothing at all
    when the computer has no driver to run.

    It waits on a press and never blocks the chat: a 40 MB download on a
    metered line is the owner's decision, not Kalsa's. A 40 MB download they
    started by accident is theirs to stop, so the bar carries the press that
    does — and the bar stays until the transfer has really stopped. */
export function DownloadDriver() {
  const { table } = useLanguage();
  const t = table.driver;
  const { state, download, cancel } = useDriver();
  const phase = state.phase;

  if (phase.kind === "unsupported") return null;

  const percent = percentOf(phase);
  const pressable = canPress(phase);
  return <>
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{t.title}</span>
        <span className="settings-row-hint">{phase.kind === "ready" ? t.ready : t.hint}</span>
      </div>
      {phase.kind === "ready" ? <span className="settings-ok">
        <Icon name="check" size={15} stroke={2.6} />{t.ready}
      </span> : <button
        type="button"
        className="settings-btn"
        disabled={!pressable}
        onClick={download}
      >
        {pressable ? <Icon name="download" size={17} /> : <span className="settings-spin" aria-hidden="true" />}
        {phase.kind === "needed" ? t.needed(sizeLabel(state.size)) : t.retry}
      </button>}
    </div>
    {phase.kind === "downloading" ? <div className="settings-update">
      <b className="settings-update-title">{t.downloading(percent)}</b>
      <progress className="settings-progress" value={phase.total ? phase.done : undefined} max={phase.total ?? undefined} />
      <div className="settings-update-actions">
        <button type="button" className="settings-btn" onClick={cancel}>{t.cancel}</button>
      </div>
    </div> : null}
    {phase.kind === "failed" ? <div className="settings-update is-failed">
      <b className="settings-update-title">{t.failed}</b>
      <div className="settings-update-actions">
        <button type="button" className="settings-btn is-primary" onClick={download}>
          <Icon name="refresh" size={17} />
          {t.retry}
        </button>
        <span className="settings-update-busy">{t.note}</span>
      </div>
    </div> : null}
    {phase.kind === "cancelled" ? <div className="settings-update">
      <b className="settings-update-title">{t.cancelled}</b>
    </div> : null}
  </>;
}