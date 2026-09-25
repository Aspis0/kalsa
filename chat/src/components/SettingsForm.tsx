import { useState } from "react";
import type { Theme } from "../lib/settings";
import type { ChatSettings } from "../lib/types";
import "./Settings.css";

interface SettingsFormProps {
  initial: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  /** Applied the moment it is touched — no Save button in between. */
  onWebTools: (enabled: boolean) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
}

/**
 * The Settings surface: the search switch, then the model this computer asks
 * its own server for.
 *
 * The switch is a privacy control, not a field of that form. It used to share
 * the form's Save, which returns early unless a server address and model are
 * filled in — and on a normal install they are not, because the brain runs on
 * this computer. So the switch could never be changed, and it defaults to on.
 */
export function SettingsForm({ initial, onSave, onWebTools, theme, onTheme }: SettingsFormProps) {
  const [model, setModel] = useState(initial.model);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(): void {
    setSaved(false);
    if (!model.trim()) {
      setError("Enter the model name the server expects.");
      return;
    }
    setError(null);
    // The switch rides along as the value App already holds — not as a field of
    // this form. Omitting it would store a record without it, and a record
    // without it reads back as `true`: Save would quietly turn the switch on.
    onSave({
      model: model.trim(),
      webTools: initial.webTools,
    });
    setSaved(true);
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>
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
          <span>Dark theme</span>
        </label>
      </div>

      <div className="settings-toggle">
        <label>
          <input
            type="checkbox"
            checked={initial.webTools}
            onChange={(event) => onWebTools(event.target.checked)}
          />
          <span>Let the assistant search the web</span>
        </label>
        <p className="settings-note">
          When your question needs something current, the assistant can search the web and open a
          page. That search — the words it chose, and the address it opens — leaves this computer
          for a search service on the internet, and what comes back is kept in the conversation.
          With this off, nothing is sent and the assistant answers from what it already knows. This
          switch is applied as soon as you change it.
        </p>
      </div>

      <p className="settings-lede">
        Messages go to this computer's own server. Everything here stays on this computer.
      </p>

      <label className="settings-field">
        <span>Model name</span>
        <input
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="my-model"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? <p className="settings-saved">Saved.</p> : null}

      <div className="settings-actions">
        <button type="button" className="btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
