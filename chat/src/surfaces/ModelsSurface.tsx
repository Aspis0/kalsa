import { useEffect, useState } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { AdvancedPanel, type AdvancedDto, type AdvancedSaveInput } from "../components/AdvancedPanel";
import { available, invoke } from "../lib/tauri";
import "./surfaces.css";

const POLL_MS = 2000;
const MODEL_NO_PICK = "You never have to pick one.";
/** Shown only when the launch record carried no reason: the development path,
 *  where the developer pinned a file and no catalog choice was made. It states
 *  nothing about a phone, because on this path a phone played no part. */
const MODEL_REASON_FALLBACK = "A model is chosen for this computer every time you turn on.";

/** What `brain_state` answers. The kind decides the sentence; on a running
 *  start the catalog's own name and its reason for THIS start travel with it. */
interface BrainState {
  kind: "stopped" | "starting" | "running" | "failed";
  model?: string | null;
  reason?: string | null;
}

interface ModelsSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// The Models surface explains that selection is automatic and owns the advanced
// launch controls. The chooser remains in Rust; this page reads its answer — the
// model and the reason it gave for this start — and sends explicit edits back to
// the start command.
export function ModelsSurface({ onNavigate }: ModelsSurfaceProps) {
  const [state, setState] = useState<BrainState | null>(null);

  useEffect(() => {
    async function refresh(): Promise<void> {
      let next: BrainState | null = null;
      if (available()) {
        try {
          next = await invoke<BrainState>("brain_state");
        } catch {
          next = null;
        }
      }
      setState(next);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  let headline: string | null = null;
  let sentence: string;
  let button: string | null = null;
  if (!state) {
    sentence = "This page could not check what this computer is running. Trying again usually works.";
  } else {
    switch (state.kind) {
      case "running":
        // The name the catalog chose is already on the wire; showing it is the
        // point. The sentence is the reason the shell gave for THIS start, not
        // a general rule about how choosing works.
        headline = state.model ? `Running ${state.model}` : "Chosen for this computer";
        sentence = `${state.reason ?? MODEL_REASON_FALLBACK} ${MODEL_NO_PICK}`;
        break;
      case "starting":
        headline = "Chosen and starting";
        sentence = "A model has been chosen for this computer. It is starting now.";
        break;
      case "failed":
        headline = "Not running";
        sentence = "This computer is not running right now. The Server page says why.";
        break;
      case "stopped":
        sentence =
          "When you turn on, this computer measures itself, picks a model it can run, and starts it. You never have to pick anything.";
        button = "Go to Server";
        break;
      default:
        sentence = "This page could not tell what this computer is running. Trying again usually works.";
    }
  }

  return (
    <div className="surface-page">
      <p className="surface-eyebrow">MODEL</p>
      <h2>How this computer thinks</h2>
      {headline ? <p className="surface-headline">{headline}</p> : null}
      <p className="surface-sentence">{sentence}</p>
      {button ? (
        <div className="surface-actions">
          <button type="button" className="btn-primary" onClick={() => onNavigate("server")}>
            {button}
          </button>
        </div>
      ) : null}
      <AdvancedPanel
        save={(changes: AdvancedSaveInput) => invoke<AdvancedDto>("brain_set_advanced", changes)}
      />
    </div>
  );
}
