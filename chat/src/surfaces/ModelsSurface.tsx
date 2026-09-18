import { useEffect, useState } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { AdvancedPanel, type AdvancedDto } from "../components/AdvancedPanel";
import { available, invoke } from "../lib/tauri";
import "./surfaces.css";

const POLL_MS = 2000;
const MODEL_AUTO =
  "A model is chosen automatically — from this computer's memory and what your phone runs — every time you turn on.";
const MODEL_NO_PICK = "You never have to pick one.";

/** What `brain_state` answers; this page only reads the kind. */
interface BrainState {
  kind: "stopped" | "starting" | "running" | "failed";
}

interface ModelsSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
}

// The Model page explains that selection is automatic and owns the advanced
// launch controls. The chooser remains in Rust; this page only reads its
// answer and sends explicit edits back to the start command.
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
        headline = "Chosen for this computer";
        sentence = `${MODEL_AUTO} ${MODEL_NO_PICK}`;
        break;
      case "starting":
        headline = "Chosen and starting";
        sentence = "A model has been chosen for this computer. It is starting now.";
        break;
      case "failed":
        headline = "Not running";
        sentence = "This computer is not running right now. The Status page says why.";
        break;
      case "stopped":
        sentence =
          "When you turn on, this computer measures itself, picks a model it can run, and starts it. You never have to pick anything.";
        button = "Go to Status";
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
        save={(contextTokens, idleUnloadSeconds) =>
          invoke<AdvancedDto>("brain_set_advanced", { contextTokens, idleUnloadSeconds })}
      />
    </div>
  );
}
