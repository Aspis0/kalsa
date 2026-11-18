import type { Engine, InstallRecipe } from "../types";
import { megabytes } from "./format";
import type { InstallProgress } from "./types";

interface Step {
  label: string;
  /** True for the stage that reports bytes, so the bar can be determinate. */
  bytes?: boolean;
}

function stepsFor(recipe: InstallRecipe): Step[] {
  return recipe.kind === "release-archive"
    ? [{ label: "Downloading", bytes: true }, { label: "Verifying checksum and extracting" }]
    : [{ label: "Downloading Python tools", bytes: true }, { label: "Installing Python packages from the lock" }];
}

/** Which of the steps the latest event belongs to. The backend reports a stage name and bytes, nothing more. */
function currentStep(recipe: InstallRecipe, progress: InstallProgress | null): number {
  if (!progress) return 0;
  if (progress.stage === "install" || progress.stage === "installed") return 1;
  return progress.total > 0 && progress.done >= progress.total && recipe.kind === "release-archive" ? 1 : 0;
}

function headline(engine: Engine, recipe: InstallRecipe, progress: InstallProgress | null, step: number): string {
  if (step === 1) return stepsFor(recipe)[1].label;
  if (!progress || progress.total === 0) return "Getting ready";
  const what = recipe.kind === "release-archive" ? `${engine.name} ${recipe.tag}` : "Python tools";
  return `Downloading ${what}, ${megabytes(progress.done)} of ${megabytes(progress.total)}`;
}

export function InstallProgressView({ engine, recipe, progress }: { engine: Engine; recipe: InstallRecipe; progress: InstallProgress | null }) {
  const step = currentStep(recipe, progress);
  const steps = stepsFor(recipe);
  const determinate = step === 0 && progress !== null && progress.total > 0;
  const percent = determinate && progress ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <>
      <p className="run-prog"><b>{headline(engine, recipe, progress, step)}</b></p>
      <div
        className={`run-track${determinate ? "" : " ind"}`}
        role="progressbar"
        aria-label="Install progress"
        {...(determinate ? { "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 } : {})}
      >
        <i style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
      <ul className="run-steps">
        {steps.map((item, index) => (
          <li key={item.label} className={index < step ? "done" : index === step ? "now" : ""}>
            <span className="run-step-i" aria-hidden="true" />{item.label}
          </li>
        ))}
      </ul>
      <p className="run-hint">This install can’t be cancelled yet. It finishes on its own.</p>
    </>
  );
}
