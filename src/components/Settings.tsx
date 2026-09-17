import { useEffect, useRef, useState } from "react";
import type { ChatSettings } from "../lib/types";
import "./Settings.css";

interface SettingsProps {
  initial: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  onClose: () => void;
}

export function Settings({ initial, onSave, onClose }: SettingsProps) {
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [token, setToken] = useState(initial.token);
  const [model, setModel] = useState(initial.model);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function save(): void {
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
    onSave({ endpoint: trimmedEndpoint, token: token.trim(), model: model.trim() });
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 id="settings-title">Settings</h2>
        <p className="settings-lede">
          Where should your messages go? Everything here stays on this computer.
        </p>

        <label className="settings-field">
          <span>Server address</span>
          <input
            ref={firstFieldRef}
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

        <div className="settings-actions">
          <button type="button" className="btn-primary" onClick={save}>
            Save
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
