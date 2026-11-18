import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import "./Panel.css";

/** The chat's side panel. Files arrive in M3; the frame stays from the old
    app so that work does not have to redraw the shell. */
export function Panel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { table } = useLanguage();
  return (
    <>
      {open ? <div className="panel-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <aside className={`panel${open ? " panel-open" : ""}`} aria-label={table.shell.files}>
        <div className="panel-head">
          <span className="panel-sub">{table.shell.files}</span>
          <button type="button" className="panel-close" onClick={onClose} aria-label={table.shell.toggleFilesAria}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <p className="panel-empty">{table.shell.dropToAttach}</p>
      </aside>
    </>
  );
}
