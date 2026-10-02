import { useState } from "react";
import type { Attachment } from "../lib/attachments";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { BudgetMeter } from "./BudgetMeter";
import { FilesBrowser } from "./FilesBrowser";
import "./Panel.css";

interface PanelProps {
  open: boolean;
  attachments: Attachment[];
  contextTokens: number | null;
  historyTokens: number;
  onRemove: (id: string) => void;
  onReattach: (id: string) => void;
  /** Attach a file from the computer: the Rust side reads the bytes, the
   *  page runs the same extractor the composer's clip uses. */
  onAttachFile: (path: string, name: string) => void;
  onClose: () => void;
}

function metaLine(t: English["files"], a: Attachment): string {
  const parts: string[] = [a.kind];
  if (a.pages !== undefined) parts.push(a.pages === 1 ? t.onePage : t.pages(a.pages));
  return parts.join(" · ");
}

/**
 * The files panel, right of the chat: this computer under Files, this
 * conversation under Attached. The attachments half is per conversation,
 * never global; the computer half is the same for every conversation.
 */
export function Panel({
  open,
  attachments,
  contextTokens,
  historyTokens,
  onRemove,
  onReattach,
  onAttachFile,
  onClose,
}: PanelProps) {
  // Attached is the default so an arriving attachment is the first thing
  // the panel shows — the behaviour the panel had before it grew a tab.
  const { table } = useLanguage();
  const t = table.files;
  const [tab, setTab] = useState<"files" | "attached">("attached");
  const active = attachments.filter((a) => a.active);
  const history = attachments.filter((a) => !a.active);
  const fileTokens = active.reduce((sum, a) => sum + a.tokens, 0);

  return (
    <>
      {open ? <div className="panel-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <aside className={`panel${open ? " panel-open" : ""}`} aria-label={t.panelAria}>
        <div className="panel-head">
          <div className="panel-tabs" role="tablist" aria-label={t.tabsAria}>
            <button
              type="button"
              role="tab"
              id="files-tab-files"
              aria-selected={tab === "files"}
              className={`panel-tab${tab === "files" ? " is-on" : ""}`}
              onClick={() => setTab("files")}
            >
              {t.filesTab}
            </button>
            <button
              type="button"
              role="tab"
              id="files-tab-attached"
              aria-selected={tab === "attached"}
              className={`panel-tab${tab === "attached" ? " is-on" : ""}`}
              onClick={() => setTab("attached")}
            >
              {t.attachedTab}
            </button>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label={t.closeAria}>
            ×
          </button>
        </div>

        {tab === "files" ? (
          <FilesBrowser onAttach={onAttachFile} />
        ) : (
          <>
            <BudgetMeter
              contextTokens={contextTokens}
              fileCount={active.length}
              docTokens={fileTokens}
              historyTokens={historyTokens}
            />

            {active.length === 0 ? (
              <p className="panel-empty">{t.empty}</p>
            ) : (
              <ul className="panel-list">
                {active.map((a) => (
                  <li key={a.id} className="panel-row">
                    <div className="panel-file">
                      <span className="panel-name" title={a.name}>
                        {a.name}
                      </span>
                      <span className="panel-meta">{metaLine(t, a)}</span>
                    </div>
                    <button type="button" className="panel-remove" onClick={() => onRemove(a.id)}>
                      {t.remove}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {history.length > 0 ? (
              <>
                <h3 className="panel-sub">{t.previouslyAttached}</h3>
                <ul className="panel-list">
                  {history.map((a) => (
                    <li key={a.id} className="panel-row panel-row-history">
                      <div className="panel-file">
                        <span className="panel-name" title={a.name}>
                          {a.name}
                        </span>
                        <span className="panel-meta">{metaLine(t, a)}</span>
                      </div>
                      <button
                        type="button"
                        className="panel-reattach"
                        onClick={() => onReattach(a.id)}
                      >
                        {t.reattach}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </aside>
    </>
  );
}
