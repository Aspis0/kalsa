import { useEffect, useState } from "react";
import type { Attachment } from "../lib/attachments";
import type { English } from "../i18n/en/all";
import { Icon } from "./Icon";
import { useLanguage } from "../i18n/useLanguage";
import { BudgetMeter } from "./BudgetMeter";
import { FilesBrowser } from "./FilesBrowser";
import { MailView } from "./mail/MailView";
import type { OpenMail } from "./mail/MailView";
import type { Drafts, SentTo } from "../lib/mail/drafts";
import type { MailCardItem } from "../lib/mail/types";
import type { PendingSend } from "../lib/mail/pending";
import "./Panel.css";
import "./mail/panelMail.css";

interface PanelProps {
  open: boolean;
  attachments: Attachment[];
  contextTokens: number | null;
  historyTokens: number;
  /** Pictures pending in the composer, counted with the files in the fit. */
  imageCount: number;
  imageTokens: number;
  onRemove: (id: string) => void;
  onReattach: (id: string) => void;
  /** The same pin the composer's chip carries: pinned rides every message,
   *  unpinned only the next one. */
  onPin: (id: string, pinned: boolean) => void;
  /** Attach a file from the computer: the Rust side reads the bytes, the
   *  page runs the same extractor the composer's clip uses. */
  onAttachFile: (path: string, name: string) => void;
  /** The mail the cards opened beside the chat, the reply being written to it,
      and the way a draft leaves. */
  mail: OpenMail | null;
  /** A mail being read, so the Mail tab is the one the press asked for while the
      read is still running. */
  mailOpening: boolean;
  mailDrafts: Drafts;
  mailSent: SentTo;
  onMailDraft: (body: string) => void;
  onMailReply: (replyToId: string, body: string) => void;
  /** The panel asks the chat model to write the reply for one mail. */
  onMailAskDraft: (item: MailCardItem) => void;
  onMailSend: (send: PendingSend) => void;
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
  imageCount,
  imageTokens,
  onRemove,
  onReattach,
  onPin,
  onAttachFile,
  mail,
  mailOpening,
  mailDrafts,
  mailSent,
  onMailDraft,
  onMailReply,
  onMailAskDraft,
  onMailSend,
  onClose,
}: PanelProps) {
  // Attached is the default so an arriving attachment is the first thing
  // the panel shows — the behaviour the panel had before it grew a tab. A card
  // that opened a mail puts that in front instead, and it does so on the press:
  // waiting for the answer left the person on «Attached» while they read.
  const { table } = useLanguage();
  const t = table.files;
  const m = table.mail;
  const [tab, setTab] = useState<"files" | "attached" | "mail">(mail !== null ? "mail" : "attached");
  useEffect(() => {
    if (mail !== null || mailOpening) setTab("mail");
  }, [mail, mailOpening]);
  // Pinned first: the documents that ride every message stand above the ones
  // riding only the next send.
  const active = attachments.filter((a) => a.active);
  const pinned = active.filter((a) => a.pinned ?? true);
  const riding = active.filter((a) => !(a.pinned ?? true));
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
            <button
              type="button"
              role="tab"
              id="files-tab-mail"
              aria-selected={tab === "mail"}
              className={`panel-tab${tab === "mail" ? " is-on" : ""}`}
              onClick={() => setTab("mail")}
            >
              {m.tab}
            </button>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label={t.closeAria}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {tab === "mail" ? (
          <MailView
            open={mail}
            opening={mailOpening}
            drafts={mailDrafts}
            sent={mailSent}
            onDraft={onMailDraft}
            onReply={onMailReply}
            onAskDraft={onMailAskDraft}
            onSend={onMailSend}
          />
        ) : tab === "files" ? (
          <FilesBrowser onAttach={onAttachFile} />
        ) : (
          <>
            <BudgetMeter
              contextTokens={contextTokens}
              fileCount={active.length}
              docTokens={fileTokens}
              historyTokens={historyTokens}
              imageCount={imageCount}
              imageTokens={imageTokens}
            />

            {active.length === 0 ? (
              <p className="panel-empty">{t.empty}</p>
            ) : (
              <>
                <h3 className="panel-sub">{t.readNext}</h3>
                <ul className="panel-list">
                  {[...pinned, ...riding].map((a) => (
                    <li key={a.id} className="panel-row">
                      <span className="panel-icon" aria-hidden="true">
                        <Icon name="file" size={18} />
                      </span>
                      <div className="panel-file">
                        <span className="panel-name" title={a.name}>
                          {a.name}
                        </span>
                        <span className="panel-meta">{metaLine(t, a)}</span>
                      </div>
                      <button
                        type="button"
                        className={`panel-pin${(a.pinned ?? true) ? " is-pinned" : ""}`}
                        aria-pressed={a.pinned ?? true}
                        title={t.pinDoc}
                        onClick={() => onPin(a.id, !(a.pinned ?? true))}
                      >
                        <Icon name="pin" size={13} />
                        {t.pinName}
                      </button>
                      <button type="button" className="panel-remove" onClick={() => onRemove(a.id)}>
                        {t.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {history.length > 0 ? (
              <>
                <h3 className="panel-sub">{t.previouslyAttached}</h3>
                <ul className="panel-list">
                  {history.map((a) => (
                    <li key={a.id} className="panel-row panel-row-history">
                      <span className="panel-icon panel-icon-quiet" aria-hidden="true">
                        <Icon name="file" size={18} />
                      </span>
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
            {active.length > 0 ? (
              <p className="panel-keep-note">
                <Icon name="pin" size={15} />
                {t.pinDoc}
              </p>
            ) : null}
          </>
        )}
      </aside>
    </>
  );
}
