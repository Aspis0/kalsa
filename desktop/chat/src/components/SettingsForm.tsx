import { useId, useState } from "react";
import { forgetThemeChoice, systemTheme, themeChoiceMade } from "../lib/settings";
import type { Theme } from "../lib/settings";
import type { ChatSettings } from "../lib/types";
import { available } from "../lib/tauri";
import { LANGUAGE_OPTIONS } from "../i18n";
import { useLanguage } from "../i18n/useLanguage";
import "./Settings.css";
import { Icon } from "./Icon";
import { TelemetrySettings } from "./TelemetrySettings";
import { Icon as MailIcon } from "./Icon";
import { UpdatesSettings } from "./UpdatesSettings";
import type { UpdatesApi } from "../lib/useUpdates";

type Look = Theme | "auto";
const LOOKS: Look[] = ["light", "dark", "auto"];

interface SettingsFormProps {
  initial: ChatSettings;
  /** Applied the moment it is touched — no Save button in between. */
  onWebTools: (enabled: boolean) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  updates: UpdatesApi;
  /** A reply is being written: the update install waits for it. */
  busy: boolean;
  /** The AI the running engine launched; null while none runs. */
  aiName: string | null;
  onOpenAi: () => void;
  onOpenMail: () => void;
  onOpenBrowser: () => void;
}

export function SettingsForm({ initial, onWebTools, theme, onTheme, updates, busy, aiName, onOpenAi, onOpenMail, onOpenBrowser }: SettingsFormProps) {
  const { table, override, choose } = useLanguage();
  const t = table.settings;
  const webTitleId = useId();
  const [look, setLook] = useState<Look>(() => (themeChoiceMade() ? theme : "auto"));
  const [webNoteOpen, setWebNoteOpen] = useState(false);
  const labels: Record<Look, string> = { light: t.lookLight, dark: t.lookDark, auto: t.lookAuto };

  function chooseLook(next: Look): void {
    setLook(next);
    if (next !== "auto") {
      onTheme(next);
      return;
    }
    // onTheme stores the theme it is given, so the stored choice is forgotten
    // after it, or the record would pin the look it is meant to drop.
    onTheme(systemTheme());
    forgetThemeChoice();
  }

  return (
    <div className="settings-page">
      <h2>{t.title}</h2>

      {/* Look and language apply the moment they change: they are preferences
          of the app, and waiting for a save would leave the page half in one
          language and half in another. */}
      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row-title">{t.look}</span>
          <div className="settings-seg" role="group" aria-label={t.look}>
            {LOOKS.map((key) => (
              <button key={key} type="button" aria-pressed={look === key} onClick={() => chooseLook(key)}>
                {labels[key]}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-row">
          <span className="settings-row-title">{t.language}</span>
          <span className="settings-select">
            <select value={override} onChange={(event) => choose(event.target.value as typeof override)}>
              <option value="system">{t.languageSystem}</option>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.ownName}
                </option>
              ))}
            </select>
            <Icon name="down" size={16} />
          </span>
        </label>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span id={webTitleId} className="settings-row-title">{t.webSearch}</span>
            <span className="settings-row-hint">{t.webSearchHint}</span>
            <button
              type="button"
              className="settings-more"
              aria-expanded={webNoteOpen}
              onClick={() => setWebNoteOpen((open) => !open)}
            >
              {t.webSearchMore}
              <Icon name={webNoteOpen ? "down" : "right"} size={14} stroke={2.2} />
            </button>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            aria-labelledby={webTitleId}
            checked={initial.webTools}
            onChange={(event) => onWebTools(event.target.checked)}
          />
        </div>
        {webNoteOpen ? (
          <div className="settings-rownote">
            <p>{t.webSearchNote}</p>
          </div>
        ) : null}
        <TelemetrySettings />
      </div>

      {/* Mail and the browser are the desktop's alone: outside it neither page
          can be drawn at all, and a row whose page comes back empty is a control
          over nothing. Telemetry stays: it is about this computer either way. */}
      {available() ? (
        <>
          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-title">{t.browser}</span>
              </div>
              <button type="button" className="settings-more settings-ai" onClick={onOpenBrowser}>
                {t.browserOpen}
                <Icon name="right" size={16} stroke={2.2} />
              </button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-title">{t.mail}</span>
                <span className="settings-row-hint">{t.mailHint}</span>
              </div>
              <button type="button" className="settings-more settings-ai" onClick={onOpenMail}>
                {t.mailOpen}
                <MailIcon name="right" size={16} stroke={2.2} />
              </button>
            </div>
          </div>
        </>
      ) : null}

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.ai}</span>
            {aiName ? <span className="settings-row-hint">{t.usingAi(aiName)}</span> : null}
          </div>
          <button type="button" className="settings-more settings-ai" onClick={onOpenAi}>
            {t.aiDetails}
            <Icon name="right" size={16} stroke={2.2} />
          </button>
        </div>
        <UpdatesSettings updates={updates} busy={busy} />
      </div>

      <p className="settings-lede">
        <Icon name="lock" size={15} />
        {t.lede}
      </p>
    </div>
  );
}
