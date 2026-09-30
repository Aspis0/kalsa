import { useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { MachineCard } from "./MachineCard";
import type { Capability } from "./MachineCard";
import { SetupProgress } from "./SetupProgress";
import type { ProgressStep } from "./SetupProgress";
import { invoke } from "../lib/tauri";
import { clearWalkStep } from "./useBrain";

// `brain_test`'s answer: the chooser's pick first, the faster one second.
interface Suggestion {
  id: string;
  name: string;
  // What downloading this model costs, as one number: its file plus the
  // drafter its row ships beside it. `drafter` says whether a second file
  // comes with the first.
  download_bytes: number;
  drafter: boolean;
  on_disk: boolean;
}

interface Suggestions {
  options: Suggestion[];
  refusal: string | null;
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

interface FirstRunProps {
  capability: Capability;
  liveStep: ProgressStep | null;
  starting: boolean;
  // Stores the choice and runs the walk: download, tune, start. Answers the
  // failure's words when it did not, so this screen can say what went wrong.
  onChoose: (token: string) => Promise<string | null>;
  // Start measured the computer: the details need the capability again.
  onChecked: () => void;
}

// Start → check → pick one → confirm the download → it runs. Local on
// purpose: a reopened app with nothing chosen begins at Start again.
export function FirstRun({ capability, liveStep, starting, onChoose, onChecked }: FirstRunProps) {
  const { table, tag } = useLanguage();
  const t = table.setup;
  const gb = (bytes: number): string => gigabytes(bytes, tag);
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [error, setError] = useState<string | null>(null);

  async function check(): Promise<void> {
    setError(null);
    setStep({ kind: "checking" });
    try {
      const suggestions = await invoke<Suggestions>("brain_test");
      onChecked();
      setStep({ kind: "pick", suggestions });
    } catch (failure) {
      setError(String(failure));
      setStep({ kind: "start" });
    }
    clearWalkStep();
  }

  async function choose(suggestions: Suggestions, option: Suggestion): Promise<void> {
    setStep({ kind: "working", suggestions });
    const failure = await onChoose(option.id);
    if (failure !== null) setStep({ kind: "failed", suggestions, error: failure });
  }

  function use(suggestions: Suggestions, option: Suggestion): void {
    if (option.on_disk) void choose(suggestions, option);
    else setStep({ kind: "confirm", suggestions, option });
  }

  let body;
  if (starting) {
    body = <p className="surface-verdict">{t.starting}</p>;
  } else if (step.kind === "checking") {
    body = <p className="surface-verdict">{t.checkingComputer}</p>;
  } else if (liveStep) {
    body = <SetupProgress step={liveStep} />;
  } else if (step.kind === "working") {
    body = <p className="surface-verdict">{t.gettingReady}</p>;
  } else if (step.kind === "failed") {
    const { suggestions, error } = step;
    body = (
      <section className="first-run-pick">
        <p className="surface-verdict">{t.notSetUp}</p>
        <p className="surface-sentence">{error}</p>
        <div className="surface-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setStep({ kind: "pick", suggestions })}
          >
            {t.tryAgain}
          </button>
        </div>
      </section>
    );
  } else if (step.kind === "confirm") {
    const { option, suggestions } = step;
    body = (
      <section className="first-run-confirm">
        <p className="surface-verdict">{t.downloadQ(gb(option.download_bytes))}</p>
        <p className="surface-sentence">
          {option.drafter ? t.needsFiles(option.name) : t.needsFile(option.name)}
        </p>
        <div className="surface-actions">
          <button type="button" className="btn-primary" onClick={() => void choose(suggestions, option)}>
            {t.download}
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => setStep({ kind: "pick", suggestions })}
          >
            {t.cancel}
          </button>
        </div>
      </section>
    );
  } else if (step.kind === "pick") {
    const { suggestions } = step;
    body = (
      <section className="first-run-pick">
        <p className="surface-verdict">{t.pickModel}</p>
        {suggestions.refusal !== null && <p className="surface-sentence">{suggestions.refusal}</p>}
        {suggestions.options.map((option, index) => (
          <div key={option.id} className="first-run-option">
            <strong className="first-run-option-name">{option.name}</strong>
            <span>{[t.smarter, t.faster][index] ?? t.faster}</span>
            <span className="first-run-option-size">
              {option.on_disk ? t.alreadyOnComputer : t.downloadSize(gb(option.download_bytes))}
            </span>
            <button type="button" className="btn-primary" onClick={() => use(suggestions, option)}>
              {t.useThis}
            </button>
          </div>
        ))}
        <details className="first-run-details">
          <summary>{t.showDetails}</summary>
          <MachineCard capability={capability} />
        </details>
      </section>
    );
  } else {
    body = (
      <div className="brain-presence">
        <button type="button" className="first-run-start" onClick={() => void check()}>
          {t.start}
        </button>
        <p className="surface-sentence">{t.suggests}</p>
        {error !== null && (
          <>
            <p className="surface-sentence">{error}</p>
            <div className="surface-actions">
              <button type="button" className="btn-quiet" onClick={() => void check()}>
                {t.tryAgain}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return <div className="surface-page brain-page brain-first-run">{body}</div>;
}
