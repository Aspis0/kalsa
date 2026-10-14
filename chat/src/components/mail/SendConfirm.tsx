import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { sendReply } from "../../lib/mail/send";
import type { PendingSend } from "../../lib/mail/pending";
import { Icon } from "../Icon";
import "./mail.css";

/**
 * The second press. Nothing reaches the server until the person has read the
 * exact To, Subject and Body here and pressed Invia again — the model cannot
 * reach this at all, because there is no send tool and this component is the
 * only caller of the command.
 */

export function SendConfirm({ pending, onClose, onSent }: {
  pending: PendingSend | null;
  onClose: () => void;
  onSent: (replyToId: string, to: string) => void;
}) {
  const { table } = useLanguage();
  const t = table.mail;
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    setRefused(null);
    setBusy(false);
  }, [pending]);

  if (pending === null) return null;

  return (
    <div
      className="dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={t.confirmSendTitle}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mail-send-dialog">
        <h3>{t.confirmSendTitle}</h3>
        <p className="mail-send-note">{t.confirmSendBody}</p>
        <dl className="mail-send-exact">
          <dt>{t.to}</dt>
          <dd>{pending.to}</dd>
          <dt>{t.subject}</dt>
          <dd>{pending.subject}</dd>
          <dt>{t.body}</dt>
          <dd className="mail-send-body">{pending.body}</dd>
        </dl>
        {refused ? <p className="mail-send-error" role="alert">{refused}</p> : null}
        <div className="mail-send-actions">
          <button type="button" className="mail-btn" ref={cancelRef} onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="mail-send-go"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void sendReply(pending.replyToId, pending.subject, pending.body, t).then((answer) => {
                setBusy(false);
                if (answer.ok) {
                  onSent(pending.replyToId, answer.sentTo);
                } else {
                  setRefused(answer.words);
                }
              });
            }}
          >
            <Icon name={busy ? "clock" : "send"} size={16} />
            {busy ? t.sending : t.send}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The buttons every place that can send a reply carries, and the state it
    lands in. One component so the chat's card and the panel's section cannot
    drift apart on what a press does. */
export function SendControls({ pending, sentTo, onAsk, onEdit, onCopy, copied }: {
  pending: PendingSend | null;
  sentTo: string | null;
  onAsk: (send: PendingSend) => void;
  onEdit: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const { table } = useLanguage();
  const t = table.mail;
  if (sentTo !== null) {
    return (
      <p className="mail-sent">
        <Icon name="check" size={16} />
        {t.sentTo(sentTo)}
      </p>
    );
  }
  return (
    <div className="mail-card-actions">
      <button type="button" className="mail-btn" onClick={onEdit}>
        <Icon name="pencil" size={16} />
        {t.edit}
      </button>
      <button type="button" className="mail-btn" onClick={onCopy}>
        <Icon name={copied ? "check" : "copy"} size={16} />
        {copied ? t.copied : t.copy}
      </button>
      <button
        type="button"
        className="mail-send-go"
        disabled={pending === null}
        onClick={() => pending !== null && onAsk(pending)}
      >
        <Icon name="send" size={16} />
        {t.send}
      </button>
    </div>
  );
}