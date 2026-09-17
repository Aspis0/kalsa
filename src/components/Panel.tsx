import type { Attachment } from "../lib/attachments";
import { BudgetMeter } from "./BudgetMeter";
import "./Panel.css";

interface PanelProps {
  open: boolean;
  attachments: Attachment[];
  contextTokens: number | null;
  historyTokens: number;
  onRemove: (id: string) => void;
  onReattach: (id: string) => void;
  onClose: () => void;
}

function metaLine(a: Attachment): string {
  const parts: string[] = [a.kind];
  if (a.pages !== undefined) parts.push(a.pages === 1 ? "1 page" : `${a.pages} pages`);
  parts.push(`≈${a.tokens} tokens`);
  return parts.join(" · ");
}

/**
 * The conversation's attachments, right of the chat: what is pinned, what it
 * costs, what was here before. Per conversation, never global.
 */
export function Panel({
  open,
  attachments,
  contextTokens,
  historyTokens,
  onRemove,
  onReattach,
  onClose,
}: PanelProps) {
  const active = attachments.filter((a) => a.active);
  const history = attachments.filter((a) => !a.active);
  const fileTokens = active.reduce((sum, a) => sum + a.tokens, 0);

  return (
    <>
      {open ? <div className="panel-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <aside className={`panel${open ? " panel-open" : ""}`} aria-label="Attachments">
        <div className="panel-head">
          <h2>Attachments</h2>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close attachments">
            ×
          </button>
        </div>

        <BudgetMeter contextTokens={contextTokens} docTokens={fileTokens} historyTokens={historyTokens} />

        {active.length === 0 ? (
          <p className="panel-empty">
            No files attached. Drop a text, markdown, PDF, Word or PowerPoint file on the
            conversation, or use the clip in the composer.
          </p>
        ) : (
          <ul className="panel-list">
            {active.map((a) => (
              <li key={a.id} className="panel-row">
                <div className="panel-file">
                  <span className="panel-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="panel-meta">{metaLine(a)}</span>
                </div>
                <button type="button" className="panel-remove" onClick={() => onRemove(a.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {history.length > 0 ? (
          <>
            <h3 className="panel-sub">Previously attached</h3>
            <ul className="panel-list">
              {history.map((a) => (
                <li key={a.id} className="panel-row panel-row-history">
                  <div className="panel-file">
                    <span className="panel-name" title={a.name}>
                      {a.name}
                    </span>
                    <span className="panel-meta">{metaLine(a)}</span>
                  </div>
                  <button type="button" className="panel-reattach" onClick={() => onReattach(a.id)}>
                    Reattach
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </>
  );
}
