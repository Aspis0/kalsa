import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import type { SurfaceKey } from "../app/surfaces";
import { AdvancedPanel, type AdvancedDto, type AdvancedSaveInput } from "../components/AdvancedPanel";
import { SamplingPanel } from "../components/SamplingPanel";
import { ReportProblem } from "../components/ReportProblem";
import { available, invoke } from "../lib/tauri";
import { lastKnown } from "../lib/slotGate";
// ONE declaration of `brain_state`'s answer, shared with the poll every other
// surface reads. A local copy of `kind` here is how "stopping" was read as
// "could not tell": the DTO moved and this page's second declaration did not.
import type { BrainState } from "./useBrain";
import "./surfaces.css";

const POLL_MS = 2000;
/** Shown only when the launch record carried no reason: the development path,
 *  where the developer pinned a file and no catalog choice was made. It states
 *  nothing about a phone, because on this path a phone played no part. */
interface ModelsSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
  model: string;
  onModelChange: (model: string) => void;
}

// The Models surface says what this computer is running and owns the advanced
// launch controls. The chooser remains in Rust; this page reads its answer — the
// model and the reason it gave for this start — and sends explicit edits back to
// the start command.
export function ModelsSurface({ onNavigate, model, onModelChange }: ModelsSurfaceProps) {
  const { table } = useLanguage();
  const t = table.machine;
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
      // A read that rejected — or one that answered nothing — keeps what
      // this page already knows; only a page that never had an answer shows
      // the "could not check" sentence.
      setState((previous) => lastKnown(previous, next));
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  let headline: string | null = null;
  let sentence: string;
  let button: string | null = null;
  if (!state) {
    sentence = t.couldNotCheck;
  } else {
    switch (state.kind) {
      case "running":
        // The name the catalog chose is already on the wire; showing it is the
        // point. The sentence is the reason the shell gave for THIS start, not
        // a general rule about how choosing works.
        headline = state.model ? t.running(state.model) : t.chosenForComputer;
        sentence = state.reason ?? t.fallbackReason;
        break;
      case "stopping":
        // The drain, in this page's own subject: the model this computer had
        // chosen is being put away. NOT the "could not tell" sentence — the
        // poll has just said exactly what is happening, and a page that
        // claims not to know the one thing the state reported is a false
        // sentence standing on screen for the whole teardown.
        headline = t.stopping;
        sentence = table.power.puttingAway;
        break;
      case "starting":
        headline = t.chosenAndStarting;
        sentence = t.startingSentence;
        break;
      case "failed":
        headline = t.notRunning;
        sentence = t.notRunningSentence;
        break;
      case "stopped":
        sentence = t.offSentence;
        button = t.goToServer;
        break;
      default: {
        // Exhaustive over the shared `kind`: a state the wire grows without
        // this page is a COMPILE error here, never a sentence this page
        // invents — the blind `default:` is what turned "stopping" into a
        // false admission of not-knowing. `never` is assignable to `string`,
        // so this line exists only to make a missing case fail `tsc`.
        const unreachable: never = state.kind;
        sentence = unreachable;
      }
    }
  }

  return (
    <div className="surface-page">
      <p className="surface-eyebrow">{t.eyebrow}</p>
      <h2>{t.howItThinks}</h2>
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
        model={model}
        onModelChange={onModelChange}
      />
      <SamplingPanel />
      <ReportProblem />
    </div>
  );
}
