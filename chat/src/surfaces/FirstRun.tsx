import { useState } from "react";
import { MachineCard, bytesText } from "./MachineCard";
import type { Capability } from "./MachineCard";
import { SetupProgress } from "./SetupProgress";
import type { ProgressStep } from "./SetupProgress";
import { invoke } from "../lib/tauri";
import { clearWalkStep } from "./useBrain";

// `brain_test`'s answer. The backend remembers the same plan, and Allow
// executes that one: the page sends nothing back.
interface TestOption {
  id: string;
  name: string;
  weights_bytes: number;
  on_disk: boolean;
}

interface TestPlan {
  engine_bytes: number;
  options: TestOption[];
  refusal: string | null;
  total_bytes: number;
}

type Step =
  | { kind: "start" }
  | { kind: "testing" }
  | { kind: "consent"; plan: TestPlan }
  | { kind: "allowing"; plan: TestPlan }
  | { kind: "card" };

const ON_DISK = "already on this computer";

interface FirstRunProps {
  capability: Capability;
  liveStep: ProgressStep | null;
  busy: boolean;
  onChoose: (token: string) => void;
  // Allow finished: the card needs the capability read again, now with
  // the tune's measured speeds.
  onAllowed: () => void;
}

// The first run: Start → Test → one consent → Allow → the card → a pick.
// Local on purpose: a reopened app with nothing chosen begins at Start, and
// Test marks what is already on disk.
export function FirstRun({ capability, liveStep, busy, onChoose, onAllowed }: FirstRunProps) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [error, setError] = useState<string | null>(null);

  async function test(): Promise<void> {
    setError(null);
    setStep({ kind: "testing" });
    try {
      setStep({ kind: "consent", plan: await invoke<TestPlan>("brain_test") });
    } catch (failure) {
      setError(String(failure));
      setStep({ kind: "start" });
    }
    clearWalkStep();
  }

  async function allow(plan: TestPlan): Promise<void> {
    setError(null);
    setStep({ kind: "allowing", plan });
    try {
      await invoke("brain_allow");
      onAllowed();
      setStep({ kind: "card" });
    } catch (failure) {
      setError(String(failure));
      setStep({ kind: "consent", plan });
    }
    clearWalkStep();
  }

  let body;
  if (liveStep) {
    body = <SetupProgress step={liveStep} />;
  } else if (step.kind === "card") {
    body = <MachineCard capability={capability} busy={busy} onChoose={onChoose} />;
  } else if (step.kind === "consent" || step.kind === "allowing") {
    const { plan } = step;
    const working = step.kind === "allowing";
    body = (
      <section className="first-run-consent" aria-label="Before Kalsa can run">
        <p className="surface-verdict">{plan.total_bytes > 0 ? "Downloads needed" : "Ready to test"}</p>
        <p className="surface-sentence">
          Kalsa downloads what is missing and tests each model on this computer. Then you pick one.
        </p>
        <ul className="first-run-list">
          <li>
            The engine that runs the model —{" "}
            {plan.engine_bytes === 0 ? ON_DISK : `up to ${bytesText(plan.engine_bytes)}`}
          </li>
          {plan.options.map((option) => (
            <li key={option.id}>
              {option.name} — {option.on_disk ? ON_DISK : bytesText(option.weights_bytes)}
            </li>
          ))}
        </ul>
        {plan.refusal !== null && <p className="surface-sentence">{plan.refusal}</p>}
        {error !== null && <p className="surface-sentence">{error}</p>}
        <div className="surface-actions">
          {plan.options.length > 0 && plan.refusal === null && (
            <button
              type="button"
              className="btn-primary"
              disabled={working}
              onClick={() => void allow(plan)}
            >
              {error === null ? "Allow" : "Try again"}
            </button>
          )}
          <button
            type="button"
            className="btn-quiet"
            disabled={working}
            onClick={() => {
              setError(null);
              setStep({ kind: "start" });
            }}
          >
            Not now
          </button>
        </div>
      </section>
    );
  } else {
    body = (
      <div className="brain-presence">
        <button
          type="button"
          className="first-run-start"
          disabled={step.kind === "testing"}
          onClick={() => void test()}
        >
          Start
        </button>
        <p className="surface-sentence">
          Kalsa checks this computer and finds the best settings for it.
        </p>
        {error !== null && (
          <>
            <p className="surface-sentence">{error}</p>
            <div className="surface-actions">
              <button type="button" className="btn-quiet" onClick={() => void test()}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return <div className="surface-page brain-page brain-first-run">{body}</div>;
}
