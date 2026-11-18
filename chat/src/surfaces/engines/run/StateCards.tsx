import type { Engine } from "../types";
import { exitLabel } from "./format";
import { RunCard } from "./RunCard";
import { FailureBody } from "./StateBodies";
import type { EngineStatus, Phase } from "./types";

const FAILURES = {
  install: ["The install did not finish", "Nothing was installed."],
  start: ["The engine could not start", ""],
  uninstall: ["Uninstall did not finish", "Some files may be left in the engine's folder."],
} as const;

/** The engine stopped on its own: the exit code, the log, and a way to go on. */
export function ExitedCard({
  engine,
  status,
  model,
  uninstall,
  onRestart,
  onChooseModel,
}: {
  engine: Engine;
  status: EngineStatus | null;
  model: string | null;
  uninstall: React.ReactNode;
  onRestart: (model: string) => void;
  onChooseModel: () => void;
}) {
  const again = model ? (
    <button type="button" className="run-btn" onClick={() => onRestart(model)}>Restart</button>
  ) : (
    <button type="button" className="run-btn" onClick={onChooseModel}>Choose a model</button>
  );
  return (
    <RunCard dot="err" label={exitLabel(status?.message ?? null)} sub={`${engine.name} stopped on its own`} actions={<>{uninstall}{again}</>}>
      <FailureBody
        headline={model ? `It could not keep running ${model}.` : "It stopped before it could answer."}
        detail="The last lines of the log are below. A smaller model usually works."
        lines={status?.logTail ?? []}
      />
    </RunCard>
  );
}

/** An install, start or uninstall that failed: what the backend said, and the one way back. */
export function FailedCard({ phase, onTryInstall, onCheckAgain }: { phase: Extract<Phase, { kind: "failed" }>; onTryInstall: () => void; onCheckAgain: () => void }) {
  const [what, detail] = FAILURES[phase.what];
  const retry = phase.what === "install"
    ? <button type="button" className="run-btn" onClick={onTryInstall}>Try again</button>
    : <button type="button" className="run-btn" onClick={onCheckAgain}>Check again</button>;
  return (
    <RunCard dot="err" label="Error" sub={what} actions={retry}>
      <FailureBody headline={phase.message} detail={detail} lines={[]} />
    </RunCard>
  );
}
