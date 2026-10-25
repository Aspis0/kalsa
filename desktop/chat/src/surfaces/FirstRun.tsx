import { useRef, useState } from "react";
import { rustSentence } from "../lib/rustText";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "../components/Icon";
import { KalsaWordmark } from "../components/KalsaWordmark";
import type { UpdatesApi } from "../lib/useUpdates";
import { modelOnly } from "../lib/modelName";
import { refusalSentence } from "./MachineCard";
import type { Capability } from "./MachineCard";
import type { ProgressStep } from "./walkState";
import type { WalkMemory } from "./useWalkMemory";
import { FirstRunPick } from "./FirstRunPick";
import type { Suggestion } from "./FirstRunPick";
import { FailedWalkScreen, FullWindow, GrowingScreen } from "./WalkScreens";
import type { FailureDetail } from "./WalkScreens";
import { invoke } from "../lib/tauri";
import { clearWalkStep } from "./useBrain";
import "./BrainSurface.css";
import "./PowerButton.css";
import "./FirstRun.css";

interface Suggestions {
  options: Suggestion[];
  refusal: string | null;
  refusal_code?: string;
}

type Step =
  | { kind: "start" }
  | { kind: "checking" }
  | { kind: "pick"; suggestions: Suggestions }
  | { kind: "confirm"; suggestions: Suggestions; option: Suggestion }
  | { kind: "working"; suggestions: Suggestions }
  | { kind: "failed"; suggestions: Suggestions; error: string };

// Decimal, like the download progress line that follows this screen.
function gigabytes(bytes: number, tag: string): string {
  const value = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1e9);
  return `${value} GB`;
}

// The first run's own waits — the check, the engine coming up, the walk
// between the pick and the first event — as steps of the one view every
// other wait renders: a static sentence here read as a frozen app for the
// whole check or the whole engine start. Constant objects, so the view's
// identity (and its clock) holds for as long as the wait does.
const STARTING_STEP: ProgressStep = { kind: "starting" };
const CHECKING_STEP: ProgressStep = { kind: "checking" };
const WORKING_STEP: ProgressStep = { kind: "working" };

interface FirstRunProps {
  capability: Capability;
  liveStep: ProgressStep | null;
  /** The walk so far, held past its last step: a failure shows where it stopped. */
  walk: WalkMemory | null;
  /** The backend's own words on a failure, behind Show details. */
  failureDetail: FailureDetail | null;
  starting: boolean;
  // The too-weak screen's one way on: an update may bring an AI that fits.
  updates: UpdatesApi;
  // Stores the choice and runs the walk: download, tune, start. Answers the
  // failure's words when it did not, so this screen can say what went wrong.
  onChoose: (token: string) => Promise<string | null>;
  // Start measured the computer: the too-weak screen reads the refusal's code.
  onChecked: () => void;
}

// Start → check → pick one → confirm the download → it runs. Local on
// purpose: a reopened app with nothing chosen begins at Start again.
export function FirstRun({ capability, liveStep, walk, failureDetail, starting, updates, onChoose, onChecked }: FirstRunProps) {
  const { table, tag } = useLanguage();
  const t = table.setup;
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [error, setError] = useState<string | null>(null);
  // One choice at a time: a double press must not store and start twice.
  const choosing = useRef(false);

  async function check(): Promise<void> {
    setError(null);
    setStep({ kind: "checking" });
    try {
      const suggestions = await invoke<Suggestions>("brain_test");
      onChecked();
      setStep({ kind: "pick", suggestions });
    } catch (failure) {
      setError(rustSentence(table.rust, failure, tag));
      setStep({ kind: "start" });
    }
    clearWalkStep();
  }

  async function choose(suggestions: Suggestions, option: Suggestion): Promise<void> {
    if (choosing.current) return;
    choosing.current = true;
    setStep({ kind: "working", suggestions });
    const failure = await onChoose(option.id);
    choosing.current = false;
    if (failure !== null) setStep({ kind: "failed", suggestions, error: failure });
  }

  function use(suggestions: Suggestions, option: Suggestion): void {
    if (option.on_disk) void choose(suggestions, option);
    else setStep({ kind: "confirm", suggestions, option });
  }

  const reach = walk?.reach ?? 0;
  if (starting) return <GrowingScreen step={STARTING_STEP} reach={reach} />;
  if (step.kind === "checking") return <GrowingScreen step={CHECKING_STEP} />;
  if (liveStep) return <GrowingScreen step={liveStep} reach={reach} />;
  if (step.kind === "working") return <GrowingScreen step={WORKING_STEP} reach={reach} />;

  if (step.kind === "failed") {
    const { suggestions, error: reason } = step;
    return (
      <FailedWalkScreen
        memory={walk ?? { last: WORKING_STEP, reach: 0 }}
        reason={reason}
        detail={failureDetail}
        busy={false}
        onRetry={() => setStep({ kind: "pick", suggestions })}
      />
    );
  }

  if (step.kind === "confirm") {
    const { option, suggestions } = step;
    const name = modelOnly(option.name);
    return (
      <FullWindow>
        <p className="first-run-step">{t.stepOf(2, 2)}</p>
        <span className="first-run-icon">
          <Icon name="download" size={44} stroke={1.8} />
        </span>
        <h1>{t.downloadQ(gigabytes(option.download_bytes, tag))}</h1>
        <p className="first-run-sub">{option.drafter ? t.needsFiles(name) : t.needsFile(name)}</p>
        <div className="first-run-actions">
          <button type="button" className="first-run-quiet" onClick={() => setStep({ kind: "pick", suggestions })}>
            {t.cancel}
          </button>
          <button type="button" className="brain-go" onClick={() => void choose(suggestions, option)}>
            <Icon name="download" size={21} stroke={2.2} />
            {t.download}
          </button>
        </div>
      </FullWindow>
    );
  }

  if (step.kind === "pick") {
    const { suggestions } = step;
    if (suggestions.options.length === 0) {
      const phase = updates.state.phase.kind;
      return (
        <FullWindow keepsRail>
          <span className="first-run-icon is-warn">
            <Icon name="laptop" size={46} stroke={1.7} />
          </span>
          <h1>{t.tooWeak}</h1>
          <p className="first-run-sub">
            {refusalSentence(
              table.machine,
              suggestions.refusal_code ?? (capability.kind === "measured" ? capability.refusal_code : undefined),
              suggestions.refusal,
            )}
          </p>
          <div className="first-run-actions">
            <button type="button" className="brain-go" disabled={phase === "checking" || phase === "downloading"} onClick={updates.check}>
              <Icon name="refresh" size={21} stroke={2.2} />
              {table.updates.check}
            </button>
          </div>
          {phase === "checking" || phase === "current" ? (
            <p className="first-run-hint" role="status">
              {phase === "checking" ? table.updates.checking : table.updates.upToDate}
            </p>
          ) : null}
          <p className="first-run-hint">{t.tooWeakNote}</p>
        </FullWindow>
      );
    }
    return (
      <FullWindow>
        {suggestions.refusal !== null ? <p className="first-run-hint">{suggestions.refusal}</p> : null}
        <FirstRunPick options={suggestions.options} onContinue={(option) => use(suggestions, option)} />
      </FullWindow>
    );
  }

  return (
    <FullWindow keepsRail={error !== null}>
      <div className="first-run-brand">
        <KalsaWordmark height={64} />
      </div>
      <h1>{t.welcome}</h1>
      <p className="first-run-sub">{t.welcomeLine}</p>
      <button type="button" className="power power-on first-run-start" onClick={() => void check()}>
        <span className="power-face">{t.start}</span>
      </button>
      {error !== null ? (
        <div className="first-run-error">
          <p role="alert">{error}</p>
          <button type="button" className="first-run-quiet is-small" onClick={() => void check()}>
            <Icon name="refresh" size={17} />
            {t.tryAgain}
          </button>
        </div>
      ) : null}
    </FullWindow>
  );
}
