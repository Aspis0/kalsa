import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke } from "../lib/tauri";
import "./AdvancedPanel.css";

const POLL_MS = 2000;

/** What `brain_advanced` answers: Rust's launch description, read-only here. */
export interface AdvancedDto {
  context_tokens: number | null;
  context_max: number | null;
  context_override: number | null;
  idle_unload_seconds: number;
  idle_override: number | null;
  batch_size: number;
  ubatch_size: number;
  kv_cache_type: string;
  flash_attention: string;
  gpu_layers: string | null;
  threads: number | null;
  door_port: number | null;
  iroh_sentence: string;
  internet_road: boolean;
  running: boolean;
}

export interface AdvancedSave {
  (contextTokens: number | null, idleUnloadSeconds: number | null, internetRoad: boolean): Promise<AdvancedDto>;
}

// A blank field means "leave it to the app": nothing is sent for it.
function numberOrNull(value: string, label: string): number | null {
  if (value === "") return null;
  const number = Number(value);
  if (Number.isInteger(number)) return number;
  throw new Error(`${label} must be a whole number.`);
}

function show(value: number | string | null): string {
  return value === null ? "automatic" : String(value);
}

// The advanced panel exposes the small set of safe launch controls. Values
// are read from Rust's launch description, and edits are sent back to the
// same command that builds the supervisor argv (the `save` prop decides the
// arguments — the Models surface sends two, this surface sends all three).
export function AdvancedPanel({ save }: { save: AdvancedSave }) {
  const [dto, setDto] = useState<AdvancedDto | null>(null);
  const [open, setOpenState] = useState(false);
  const [context, setContext] = useState("");
  const [idle, setIdle] = useState("");
  const [road, setRoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // While the owner is editing — or has edited — a field, a poll must never
  // overwrite what is in the inputs.
  const dirty = useRef(false);
  const focused = useRef(false);
  const openRef = useRef(false);

  const syncInputs = useCallback((next: AdvancedDto | null): void => {
    if (dirty.current || focused.current) return;
    setContext(next ? String(next.context_override ?? "") : "");
    setIdle(next ? String(next.idle_override ?? next.idle_unload_seconds ?? "") : "");
    setRoad(next ? next.internet_road : false);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    let next: AdvancedDto | null = null;
    if (available()) {
      try {
        next = await invoke<AdvancedDto>("brain_advanced");
      } catch {
        // While open, a failed read keeps the last known values on screen.
        if (openRef.current) return;
        next = null;
      }
    }
    setDto(next);
    syncInputs(next);
  }, [syncInputs]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  function toggle(): void {
    const next = !openRef.current;
    openRef.current = next;
    setOpenState(next);
    if (next) {
      dirty.current = false;
      focused.current = false;
      setFeedback(null);
      syncInputs(dto);
    }
  }

  function trackInput(setValue: (value: string) => void) {
    return {
      onFocus: () => {
        focused.current = true;
      },
      onBlur: () => {
        focused.current = false;
      },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        dirty.current = true;
        setValue(event.target.value);
      },
    };
  }

  async function saveEdits(): Promise<void> {
    setFeedback(null);
    setSaving(true);
    try {
      const saved = await save(numberOrNull(context, "Context size"), numberOrNull(idle, "Idle time"), road);
      setDto(saved);
      dirty.current = false;
      syncInputs(saved);
      setFeedback("Saved for the next start.");
    } catch (error) {
      setFeedback(String(error));
    }
    setSaving(false);
  }

  return (
    <div className="advanced-panel">
      <p className="advanced-eyebrow">ADVANCED</p>
      <p className="advanced-title">Server settings</p>
      <button type="button" className="btn-quiet advanced-toggle" aria-expanded={open} onClick={toggle}>
        {open ? "Hide settings" : "Show settings"}
      </button>
      {open ? (
        <div className="advanced-body">
          <p className="advanced-note">
            {dto
              ? dto.running
                ? "The current server stays as it is. Changes apply next time you turn on."
                : "Changes apply next time you turn on."
              : "These settings are available inside the Kalsa Brain app."}
          </p>
          <label className="advanced-field">
            <span className="advanced-field-label">Context size</span>
            <input
              type="number"
              min={512}
              max={32768}
              step={512}
              placeholder="Automatic"
              value={context}
              {...trackInput(setContext)}
            />
          </label>
          <p className="advanced-help">
            {dto
              ? dto.context_max
                ? `Automatic is up to ${dto.context_max}. A smaller value uses less memory.`
                : "Automatic uses the value chosen for this computer."
              : "The app will read the machine before choosing a value."}
          </p>
          <label className="advanced-field">
            <span className="advanced-field-label">Unload after idle</span>
            <input type="number" min={60} max={3600} step={60} value={idle} {...trackInput(setIdle)} />
          </label>
          <p className="advanced-help">
            Between 60 seconds and 1 hour, so an ordinary pause does not reload the model.
          </p>
          <label className="advanced-field advanced-field-check">
            <span className="advanced-field-label">Internet road</span>
            <input
              type="checkbox"
              checked={road}
              onFocus={() => {
                focused.current = true;
              }}
              onBlur={() => {
                focused.current = false;
              }}
              onChange={(event) => {
                dirty.current = true;
                setRoad(event.target.checked);
              }}
            />
          </label>
          {dto ? (
            <p className="advanced-help">Opens a second way in over the internet: this computer announces itself on a public directory service, so the phone can find it without Tailscale. The door stays password-checked. Off is the default.</p>
          ) : null}
          <p className="advanced-values">
            {dto
              ? `${dto.running ? "In force" : "Next start"}: context ${show(dto.context_tokens)}; batch ${show(
                  dto.batch_size,
                )}; micro-batch ${show(dto.ubatch_size)}; KV ${show(dto.kv_cache_type)}; flash attention ${show(
                  dto.flash_attention,
                )}; GPU layers ${show(dto.gpu_layers)}; threads ${show(dto.threads)}; idle unload ${show(
                  dto.idle_unload_seconds,
                )} seconds.`
              : "The values in force will appear here when the app is open."}
          </p>
          <p className="advanced-help">
            {dto && dto.door_port
              ? `Local door: ${dto.door_port}. Run for Tailscale: tailscale serve ${dto.door_port}`
              : "The local door is waiting for the server to run."}
          </p>
          <p className="advanced-help">
            {dto ? dto.iroh_sentence : "The internet road is waiting for the server to run."}
          </p>
          {dto ? (
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveEdits()}>
              Save settings
            </button>
          ) : null}
          {feedback ? <p className="advanced-feedback">{feedback}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
