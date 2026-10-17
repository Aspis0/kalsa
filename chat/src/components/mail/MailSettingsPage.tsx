import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { available, invoke } from "../../lib/tauri";
import { readAccount } from "../../lib/mail/account";
import { forgetAll } from "../../lib/mail/lastList";
import { prepareCredentials } from "../../lib/mail/credentials";
import { accountErrorKey } from "../../lib/mail/accountError";
import { guessServer } from "../../lib/mail/providers";
import { appPasswordProvider } from "../../lib/mail/appPassword";
import { mailAllowed } from "../../lib/mail/allowlist";
import { rustSentence } from "../../lib/rustText";
import { useBrain } from "../../surfaces/useBrain";
import { usePairedDevices } from "../../surfaces/usePairedDevices";
import { deviceName, hidesOnSeat } from "../../surfaces/pairingWords";
import type { PairedDevice } from "../../surfaces/pairingWords";
import { Icon } from "../Icon";
import { AppPasswordBox } from "./AppPasswordBox";
import "../Settings.css";
import "./settingsMail.css";

/**
 * Mail's own page, reached from Settings by its row. It holds the account, the
 * Prova that lists three subjects, and the permissions in For experts — the
 * values are shown, not asked for: reading is automatic, sending asks, and
 * deleting is blocked whatever the person would prefer. Below them, which of
 * the paired phones may read this mailbox: a switch per phone, because a
 * phone that belongs to somebody else is not this person's to spend.
 */

/** The words for a refused command. Tauri rejects a refusal with its `{ code }`
    and an argument it cannot read with a plain string, so only a code can be
    named. */
function refusalCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

export function MailSettingsPage({ onBack }: { onBack: () => void }) {
  const { table, tag } = useLanguage();
  const t = table.mail;
  const { state } = useBrain();
  // The paired phones come from the read-only list, not from the Pairing
  // page's reader: that read expires what is due, mints or retires a square
  // and detects a tailnet, and this page wants a list — on a page whose whole
  // subject is somebody else's phone, a square the owner never asked to see
  // is not a side worth paying for.
  const { devices: house, unreadable, applyMail } = usePairedDevices();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  /** Where the host in the field came from. A typed or saved host is the
      person's own and rides the save; a guessed one is the app's, and the
      backend guesses the same one from the address. */
  const [serverSource, setServerSource] = useState<"typed" | "saved" | "guess">("guess");
  const [note, setNote] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** What this machine has linked, from the backend on open and after every
      save or removal, so the fields and the line above them cannot disagree. */
  const [linked, setLinked] = useState("");
  /** A refused save, kept until the next attempt: a reason that disappears on
      the next click is not something the person can act on. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Set by every save and every removal: an answer that was already on its
      way must not put the old account back under the person's hands. */
  const answered = useRef(false);
  const [readFailed, setReadFailed] = useState(false);
  const [passwordShown, setPasswordShown] = useState(false);
  /** Whether this address wants a code of its own; read from the address so
      the box appears while the person is still typing it. */
  const appPassword = appPasswordProvider(email);
  /** The address must be whole before it can name a provider, so an unfinished
      one gets the plain form of the fields rather than a wrong guess. */
  const canSave = email.includes("@") && password !== "";
  /** The fields already stand for the linked account: there is nothing missing
      to write, and saying otherwise after a saved account reads as a fault. */
  const saved = linked !== "" && email.trim() === linked;
  const missing = saved ? "" : email.includes("@") ? (password === "" ? t.needPassword : "") : t.needEmail;
  /** This address's steps on their own; both providers while it is still blank,
      because which one it will be is what the person has not said yet. */
  const helpProviders = appPassword === null ? [] : [appPassword];
  const helpShown = helpOpen || appPassword !== null;

  /**
   * The phones that could read this mailbox, one row each. The same reading
   * the Phones page draws its own rows from: this computer's record is not a
   * phone, a record sitting on its seat's row is that seat, and a phone the
   * owner has not allowed yet cannot reach the door at all — a switch for it
   * would be a switch for nothing.
   *
   * `house` is null until the first read answers, which is the third answer
   * this section has: not "no phone", but "not known yet".
   */
  const known = house !== null;
  const phones = (house ?? []).filter(
    (device) => device.kind !== "host" && !hidesOnSeat(device, house ?? []) && device.waiting !== true,
  );
  /** The phone whose switch is being written, so a second press waits. */
  const [switching, setSwitching] = useState<number | null>(null);
  /** A refused switch, kept until the next press: a reason that disappears on
      its own is not something the owner can act on. */
  const [switchError, setSwitchError] = useState<string | null>(null);

  /** One phone's switch, as the owner left it: the store's answer, and a
      phone whose record predates the switch reads as the mail it had. */
  function phoneMail(device: PairedDevice): boolean {
    return device.mail !== false;
  }

  /**
   * The switch moves under the finger and the store catches up: a poll is
   * seconds away, and a control that waits for it reads as broken. A save the
   * store refuses puts the switch back where it was rather than leaving a lie
   * on screen, and says so in the app's own words for the refusal. Nothing
   * else is touched — a turn already running keeps the tools it started with.
   */
  function setPhoneMail(id: number, allowed: boolean): void {
    setSwitching(id);
    setSwitchError(null);
    applyMail(id, allowed);
    void invoke("brain_pairing_set_phone_mail", { id, allowed })
      .catch((error: unknown) => {
        applyMail(id, !allowed);
        setSwitchError(rustSentence(table.rust, error, tag));
      })
      .finally(() => setSwitching((busy) => (busy === id ? null : busy)));
  }

  useEffect(() => {
    // The answer lands after the page is up, so it fills what is still empty:
    // a field the person has already typed into is theirs, not the backend's.
    void readAccount().then(
      (account) => {
      if (account === null || answered.current) return;
      setReadFailed(false);
      setLinked(account.email);
      setEmail((typed) => (typed === "" ? account.email : typed));
      if (account.host !== "") {
        setServer((typed) => (typed === "" ? account.host : typed));
        setServerSource((source) => (source === "guess" ? "saved" : source));
      }
      },
      // A read that fails leaves the page usable and says it does not know:
      // claiming no account is there would be a sentence it cannot stand behind.
      () => {
        if (!answered.current) setReadFailed(true);
      },
    );
  }, []);

  // The mailbox is closed to any model but the approved ones, so the page says
  // where to change it rather than leaving a form that cannot be used.
  const running = state?.kind === "running" && typeof state.model === "string" ? state.model : "";
  const modelBlocked = running !== "" && !mailAllowed(running);

  function onEmail(next: string): void {
    setEmail(next);
    const guess = guessServer(next);
    // A host the person typed outranks any address; one the app guessed or the
    // account saved gives way, because the address they just named decides.
    if (serverSource !== "typed") {
      setServer(guess?.host ?? "");
      setServerSource("guess");
    }
    setNote(guess === null && next.includes("@") ? t.unknownServer : null);
  }

  /** One press does the whole thing: keep the account, then check it. Two
      buttons made a question the page could not answer — Prova tested the
      saved account, which is nothing at all when the person has not saved one
      yet, and it said so in words about a password that was never used. */
  async function connect(): Promise<void> {
    if (!canSave) return;
    answered.current = true;
    setReadFailed(false);
    setBusy(true);
    setNote(null);
    setSaveError(null);
    setSubjects([]);
    try {
      const own = serverSource !== "guess" && server.trim() !== "" ? { host: server.trim() } : {};
      const given = prepareCredentials(email, password);
      await invoke("brain_mail_account_save", { input: { ...given, ...own } });
      setLinked(given.email);
      const found = await invoke<string[]>("brain_mail_account_test");
      setSubjects(found);
      setNote(t.testOk(found.length));
      setPassword("");
      setPasswordShown(false);
    } catch (error) {
      const code = refusalCode(error);
      setSaveError(t.errors[accountErrorKey(code)]);
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
        {modelBlocked ? (
          <p className="mail-settings-block" role="status">
            <Icon name="alert" size={15} />
            {t.modelNotAllowed}
          </p>
        ) : (
          <>
            {/* The account this machine has, said before anything is asked of
                the person: an empty page that looks like a form is a form. */}
            <p className={linked === "" || readFailed ? "mail-linked is-none" : "mail-linked"} role="status">
              <Icon name={linked === "" || readFailed ? "info" : "check"} size={15} />
              {readFailed ? t.accountUnknown : linked === "" ? t.accountNone : t.accountLinked(linked)}
            </p>

            <div className="mail-help">
              <p className="mail-help-line">{t.helpAlways}</p>
              <button
                type="button"
                className="mail-help-toggle"
                aria-expanded={helpShown}
                onClick={() => setHelpOpen((open) => !open)}
              >
                <Icon name={helpShown ? "down" : "right"} size={14} stroke={2.2} />
                {t.helpShow}
              </button>
            </div>
            <div className="mail-settings-fields">
              <label className="mail-field">
                <span>{t.email}</span>
                <input type="email" value={email} placeholder={t.emailPlaceholder} onChange={(event) => onEmail(event.target.value)} />
              </label>
              {/* The eye is a sibling of the input, never inside the label: a
                  button inside a label is announced as part of the field. */}
              <div className="mail-field">
                <label htmlFor="mail-password">{t.password}</label>
                <span className="mail-field-with-eye">
                  <input
                    id="mail-password"
                    type={passwordShown ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="mail-eye"
                    aria-label={passwordShown ? t.hidePassword : t.showPassword}
                    aria-pressed={passwordShown}
                    onClick={() => setPasswordShown((shown) => !shown)}
                  >
                    <Icon name={passwordShown ? "eyeOff" : "eye"} size={16} />
                  </button>
                </span>
                {linked === "" ? null : <small>{t.passwordKept}</small>}
              </div>
              <label className="mail-field">
                <span>{t.server}</span>
                <input
                  type="text"
                  value={serverSource === "guess" ? "" : server}
                  placeholder={serverSource === "guess" ? server || t.serverPlaceholder : ""}
                  onChange={(event) => {
                    setServer(event.target.value);
                    setServerSource("typed");
                  }}
                />
              </label>
            </div>
            {helpShown ? <AppPasswordBox providers={helpOpen || appPassword === null ? ["google", "apple"] : helpProviders} /> : null}
            {guessServer(email)?.supported === false ? (
              <p className="mail-settings-block" role="status">
                <Icon name="info" size={15} />
                {t.outlook}
              </p>
            ) : null}
            <div className="mail-settings-actions">
              <button type="button" className="mail-btn" disabled={busy || !canSave} onClick={() => void connect()}>
                <Icon name="check" size={16} />
                {busy ? t.testing : t.connect}
              </button>
              {linked !== "" ? (
                <button
                  type="button"
                  className="mail-btn"
                  disabled={busy}
                  onClick={() => {
                    answered.current = true;
                    setReadFailed(false);
                    setBusy(true);
                    void invoke("brain_mail_account_delete").then(
                      () => {
                        setBusy(false);
                        setSubjects([]);
                        setLinked("");
                        forgetAll();
                        setNote(t.removed);
                      },
                      () => setBusy(false),
                    );
                  }}
                >
                  <Icon name="trash" size={16} />
                  {t.remove}
                </button>
              ) : null}
            </div>
            {saveError !== null ? (
              <p className="mail-note is-warn" role="alert">
                <Icon name="alert" size={15} />
                {saveError}
              </p>
            ) : missing !== "" ? (
              <p className="mail-note">{missing}</p>
            ) : null}
            {note !== null ? (
              <p className="mail-note" role="status">
                <Icon name="check" size={15} />
                {note}
              </p>
            ) : null}
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

      {/* Whose phones may read this mailbox. Outside the block above's
          conditional: an AI that cannot read mail is not a reason to leave
          the owner without a switch over who can. */}
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.phonesTitle}</span>
            <span className="settings-row-hint">{t.phonesHint}</span>
          </div>
        </div>
        {unreadable ? (
          <p className="mail-note is-warn" role="alert">
            <Icon name="alert" size={15} />
            {t.phonesUnreadable}
          </p>
        ) : null}
        {/* Nothing at all while the first read is in flight: a line saying no
            phone is paired would be a guess the page cannot stand behind, and
            a line saying it could not read would be a failure it has not had
            yet. */}
        {!known ? null : phones.length === 0 ? (
          <p className="mail-note">{t.phonesEmpty}</p>
        ) : (
          <ul className="mail-phones">
            {phones.map((device) => (
              <li key={device.id} className="mail-phone">
                <span className="mail-phone-name">{deviceName(table.devices, device)}</span>
                <input
                  className="mail-phone-switch"
                  type="checkbox"
                  role="switch"
                  checked={phoneMail(device)}
                  disabled={switching === device.id}
                  aria-label={deviceName(table.devices, device)}
                  onChange={(event) => setPhoneMail(device.id, event.currentTarget.checked)}
                />
              </li>
            ))}
          </ul>
        )}
        {switchError !== null ? (
          <p className="mail-note is-warn" role="alert">
            <Icon name="alert" size={15} />
            {switchError}
          </p>
        ) : null}
      </div>
    </div>
  );
}