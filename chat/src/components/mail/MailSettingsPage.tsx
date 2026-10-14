import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { available, invoke } from "../../lib/tauri";
import { rememberAccount } from "../../lib/mail/account";
import { guessServer, needsAppPassword } from "../../lib/mail/providers";
import { mailAllowed } from "../../lib/mail/allowlist";
import { useBrain } from "../../surfaces/useBrain";
import { Icon } from "../Icon";
import "../Settings.css";
import "./settingsMail.css";

/**
 * Mail's own page, reached from Settings by its row. It holds the account, the
 * Prova that lists three subjects, and the permissions in For experts — the
 * values are shown, not asked for: reading is automatic, sending asks, and
 * deleting is blocked whatever the person would prefer.
 */

export function MailSettingsPage({ onBack }: { onBack: () => void }) {
  const { table } = useLanguage();
  const t = table.mail;
  const { state } = useBrain();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // The mailbox is closed to any model but the approved ones, so the page says
  // where to change it rather than leaving a form that cannot be used.
  const running = state?.kind === "running" && typeof state.model === "string" ? state.model : "";
  const tooSmall = running !== "" && !mailAllowed(running);

  function onEmail(next: string): void {
    setEmail(next);
    const guess = guessServer(next);
    if (guess !== null) setServer(guess.host);
    setNote(guess === null && next.includes("@") ? { kind: "warn", text: t.unknownServer } : null);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      await invoke("brain_mail_account_save", { input: { email, password, server } });
      // The address is the card's "A:", and no command reads it back, so the
      // page keeps it from the moment the person saves it.
      rememberAccount(email);
      setNote({ kind: "ok", text: t.saved });
      setPassword("");
    } catch (error) {
      setNote({ kind: "warn", text: error instanceof Error ? error.message : t.testFailed });
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setBusy(true);
    setSubjects([]);
    setNote(null);
    try {
      const found = await invoke<string[]>("brain_mail_account_test");
      setSubjects(found);
      setNote({ kind: "ok", text: t.testOk(found.length) });
    } catch {
      setNote({ kind: "warn", text: t.testFailed });
    } finally {
      setBusy(false);
    }
  }

  if (!available()) return null;

  return (
    <div className="settings-page">
      <h2>{t.title}</h2>
      <button type="button" className="mail-back" onClick={onBack}>
        <Icon name="left" size={16} stroke={2.2} />
        {t.back}
      </button>

      <div className="settings-group">
        {tooSmall ? (
          <p className="mail-settings-block" role="status">
            <Icon name="alert" size={15} />
            {t.smallModel}
          </p>
        ) : (
          <>
            <div className="mail-settings-fields">
              <label className="mail-field">
                <span>{t.email}</span>
                <input type="email" value={email} placeholder="nome@esempio.it" onChange={(event) => onEmail(event.target.value)} />
              </label>
              <label className="mail-field">
                <span>{t.password}</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                {needsAppPassword(email) ? <small>{t.appPassword}</small> : null}
              </label>
              <label className="mail-field">
                <span>{t.server}</span>
                <input type="text" value={server} placeholder="imap.esempio.it" onChange={(event) => setServer(event.target.value)} />
              </label>
            </div>
            {guessServer(email)?.supported === false ? (
              <p className="mail-settings-block" role="status">
                <Icon name="info" size={15} />
                {t.outlook}
              </p>
            ) : null}
            <div className="mail-settings-actions">
              <button type="button" className="mail-btn" disabled={busy} onClick={() => void save()}>
                <Icon name="check" size={16} />
                {t.save}
              </button>
              <button type="button" className="mail-btn" disabled={busy} onClick={() => void test()}>
                <Icon name="zap" size={16} />
                {busy ? t.testing : t.test}
              </button>
              <button
                type="button"
                className="mail-btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void invoke("brain_mail_account_delete").then(
                    () => {
                      setBusy(false);
                      setSubjects([]);
                      setNote({ kind: "ok", text: t.removed });
                    },
                    () => setBusy(false),
                  );
                }}
              >
                <Icon name="trash" size={16} />
                {t.remove}
              </button>
            </div>
            {note ? <p className={`mail-note${note.kind === "warn" ? " is-warn" : ""}`} role="status">{note.text}</p> : null}
            {subjects.length > 0 ? (
              <ul className="mail-subjects">
                {subjects.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.canDo}</span>
          </div>
        </div>
        <div className="mail-perms">
          <span className="mail-perm is-allow">{t.permRead}</span>
          <span className="mail-perm is-ask">{t.permSend}</span>
          <span className="mail-perm is-deny">{t.permDelete}</span>
        </div>
      </div>
    </div>
  );
}