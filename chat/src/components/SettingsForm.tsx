import { useState } from "react";
import type { ChatSettings } from "../lib/types";
import "./Settings.css";

interface SettingsFormProps {
  initial: ChatSettings;
  onSave: (settings: ChatSettings) => void;
}

/** The connection form. Lives on the Settings surface — no dialog. */
export function SettingsForm({ initial, onSave }: SettingsFormProps) {
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [token, setToken] = useState(initial.token);
  const [model, setModel] = useState(initial.model);
  const [webTools, setWebTools] = useState(initial.webTools);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(): void {
    setSaved(false);
    const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
    if (!trimmedEndpoint) {
      setError("Enter the server address, for example https://my-server:8000.");
      return;
    }
    try {
      const url = new URL(trimmedEndpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    } catch {
      setError("That address does not look right — it should start with http:// or https://.");
      return;
    }
    if (!model.trim()) {
      setError("Enter the model name the server expects.");
      return;
    }
    setError(null);
    onSave({ endpoint: trimmedEndpoint, token: token.trim(), model: model.trim(), webTools });
    setSaved(true);
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>
      <p className="settings-lede">
        Where should your messages go? Everything here stays on this computer.
      </p>

      <label className="settings-field">
        <span>Server address</span>
        <input
          type="url"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://my-server:8000"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="settings-field">
        <span>API key</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

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

      <div className="settings-toggle">
        <label>
          <input
            type="checkbox"
            checked={webTools}
            onChange={(event) => setWebTools(event.target.checked)}
          />
          <span>Let the assistant search the web</span>
        </label>
        <p className="settings-note">
          When your question needs something current, the assistant can search the web and open a
          page. That search — the words it chose, and the address it opens — leaves this computer
          for a search service on the internet, and what comes back is kept in the conversation.
          With this off, nothing is sent and the assistant answers from what it already knows.
        </p>
      </div>

      <div className="settings-actions">
        <button type="button" className="btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
