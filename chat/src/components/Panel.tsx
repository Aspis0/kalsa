import { useState } from "react";
import type { Attachment } from "../lib/attachments";
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

function metaLine(a: Attachment): string {
  const parts: string[] = [a.kind];
  if (a.pages !== undefined) parts.push(a.pages === 1 ? "1 page" : `${a.pages} pages`);
  parts.push(`≈${a.tokens} tokens`);
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
  const [tab, setTab] = useState<"files" | "attached">("attached");
  const active = attachments.filter((a) => a.active);
  const history = attachments.filter((a) => !a.active);
  const fileTokens = active.reduce((sum, a) => sum + a.tokens, 0);

  return (
    <>
      {open ? <div className="panel-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <aside className={`panel${open ? " panel-open" : ""}`} aria-label="Files">
        <div className="panel-head">
          <div className="panel-tabs" role="tablist" aria-label="Files panel">
            <button
              type="button"
              role="tab"
              id="files-tab-files"
              aria-selected={tab === "files"}
              className={`panel-tab${tab === "files" ? " is-on" : ""}`}
              onClick={() => setTab("files")}
            >
              Files
            </button>
            <button
              type="button"
              role="tab"
              id="files-tab-attached"
              aria-selected={tab === "attached"}
              className={`panel-tab${tab === "attached" ? " is-on" : ""}`}
              onClick={() => setTab("attached")}
            >
              Attached
            </button>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </div>

        {tab === "files" ? (
          <FilesBrowser onAttach={onAttachFile} />
        ) : (
          <>
            <BudgetMeter
              contextTokens={contextTokens}
              docTokens={fileTokens}
              historyTokens={historyTokens}
            />

            {active.length === 0 ? (
              <p className="panel-empty">
                No files attached. Drop a text, markdown, CSV, PDF, Word or PowerPoint file on the
                conversation, use the clip in the composer, or pick one from this computer under
                Files.
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
                      <button
                        type="button"
                        className="panel-reattach"
                        onClick={() => onReattach(a.id)}
                      >
                        Reattach
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
