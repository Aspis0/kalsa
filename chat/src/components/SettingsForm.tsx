import { useState } from "react";
import type { Theme } from "../lib/settings";
import type { ChatSettings } from "../lib/types";
import { LANGUAGE_OPTIONS } from "../i18n";
import { useLanguage } from "../i18n/useLanguage";
import "./Settings.css";
import { TelemetrySettings } from "./TelemetrySettings";

interface SettingsFormProps {
  initial: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  /** Applied the moment it is touched — no Save button in between. */
  onWebTools: (enabled: boolean) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

export function SettingsForm({ initial, onSave, onWebTools, theme, onTheme }: SettingsFormProps) {
  const [saved, setSaved] = useState(false);
  const { table, override, choose } = useLanguage();
  const t = table.settings;

  function save(): void {
    // The model name is typed on the AI page now; Save carries the
    // stored one unchanged, and the web-switch rides along as the value App
    // already holds — omitting it would store a record without it, and a
    // record without it reads back as `true`.
    onSave({
      model: initial.model,
      webTools: initial.webTools,
    });
    setSaved(true);
  }

  return (
    <div className="settings-page">
      <h2>{t.title}</h2>
      {/* Appearance first, and applied on the spot like the switch below: it
          is a preference of the app, not a field of the connection form, and it
          used to be a button in every header. */}
      <div className="settings-toggle">
        <label>
          <input
            type="checkbox"
            checked={theme === "dark"}
            onChange={(event) => onTheme(event.target.checked ? "dark" : "light")}
          />
          <span>{t.darkTheme}</span>
        </label>
      </div>

      {/* The language row: applied the moment it changes, like the theme —
          it is a preference of the app, and waiting for Save would leave
          the page half in one language and half in another. Each option is
          shown in its own language so it survives not knowing the current
          one. */}
      <label className="settings-field">
        <span>{t.language}</span>
        <select value={override} onChange={(event) => choose(event.target.value as typeof override)}>
          <option value="system">{t.languageSystem}</option>
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.ownName}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-toggle">
        <label>
          <input
            type="checkbox"
            checked={initial.webTools}
            onChange={(event) => onWebTools(event.target.checked)}
          />
          <span>{t.webSearch}</span>
        </label>
        <p className="settings-note">{t.webSearchNote}</p>
      </div>

      <TelemetrySettings />

      <p className="settings-lede">{t.lede}</p>

      {saved ? <p className="settings-saved">{t.saved}</p> : null}

      <div className="settings-actions">
        <button type="button" className="btn-primary" onClick={save}>
          {t.save}
        </button>
      </div>
    </div>
  );
}
