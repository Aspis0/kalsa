import "./EmptyState.css";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";

/** The empty chat: one sentence and the page that installs an engine. */
export function EmptyState({ onOpenEngines }: { onOpenEngines: () => void }) {
  const { table } = useLanguage();
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        <Icon name="cpu" size={36} stroke={1.9} />
      </div>
      <h2 className="empty-title">{table.firstPage.title}</h2>
      <p className="empty-copy">{table.firstPage.noEngine}</p>
      <button type="button" className="btn-primary btn-large" onClick={onOpenEngines}>
        {table.firstPage.openEngines}
      </button>
    </div>
  );
}
