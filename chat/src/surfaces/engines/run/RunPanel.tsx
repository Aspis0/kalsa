import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { Engine, InstallRecipe } from "../types";
import { InstallProgressView } from "./InstallProgress";
import { ModelPicker } from "./ModelPicker";
import { NeedsApp, NoRecipe } from "./NoRecipe";
import { RunCard } from "./RunCard";
import { InstallSheet, UninstallSheet } from "./Sheets";
import { ExitedCard, FailedCard } from "./StateCards";
import { RunningBody, StartingBody } from "./StateBodies";
import { useEngineRun } from "./useEngineRun";
import "./run.css";

interface PanelProps {
  engine: Engine;
  ramBytes: number;
  onOpenChat: (engineId: string) => void;
}

type SheetKind = "install" | "uninstall" | null;

function InstallableRun({ engine, recipe, ramBytes, onOpenChat }: PanelProps & { recipe: InstallRecipe }) {
  const run = useEngineRun(engine.id);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const { phase, status } = run;
  const version = recipe.kind === "release-archive" ? recipe.tag : recipe.version;
  const sub = `${engine.name} ${version}`;
  const uninstall = <button type="button" className="run-btn quiet" onClick={() => setSheet("uninstall")}>Uninstall</button>;
  const stop = <button type="button" className="run-btn sec" onClick={run.stop}>Stop</button>;

  let card: ReactNode;
  if (phase.kind === "loading") {
    card = <RunCard dot="ring" label="Checking" sub={sub} />;
  } else if (phase.kind === "notInstalled") {
    card = <RunCard dot="ring" label="Not installed" sub={sub} actions={<button type="button" className="run-btn" onClick={() => setSheet("install")}>Install</button>} />;
  } else if (phase.kind === "installing") {
    card = <RunCard dot="busy" label="Installing" sub={sub}><InstallProgressView engine={engine} recipe={recipe} progress={phase.progress} /></RunCard>;
  } else if (phase.kind === "installed") {
    card = <RunCard dot="on" label="Installed" sub={sub} actions={uninstall}><ModelPicker engine={engine} ramBytes={ramBytes} onStart={run.start} /></RunCard>;
  } else if (phase.kind === "starting") {
    card = <RunCard dot="busy" label="Starting" sub={phase.model ? `${engine.name} with ${phase.model}` : sub} actions={stop}><StartingBody status={status} /></RunCard>;
  } else if (phase.kind === "running" && status) {
    const open = <button type="button" className="run-btn" onClick={() => onOpenChat(engine.id)}>Open chat</button>;
    card = <RunCard dot="on" label="Running" sub={sub} actions={<>{stop}{open}</>}><RunningBody status={status} model={phase.model} /></RunCard>;
  } else if (phase.kind === "exited") {
    card = <ExitedCard engine={engine} status={status} model={phase.model} uninstall={uninstall} onRestart={run.start} onChooseModel={run.stop} />;
  } else if (phase.kind === "failed") {
    card = <FailedCard phase={phase} onTryInstall={() => setSheet("install")} onCheckAgain={run.refresh} />;
  } else {
    card = <RunCard dot="ring" label="Checking" sub={sub} />;
  }

  return (
    <>
      {card}
      {sheet === "install" ? <InstallSheet engine={engine} recipe={recipe} onCancel={closeSheet} onInstall={() => { closeSheet(); run.install(); }} /> : null}
      {sheet === "uninstall" ? <UninstallSheet engine={engine} onCancel={closeSheet} onUninstall={() => { closeSheet(); run.uninstall(); }} /> : null}
    </>
  );
}

/** The install and run panel on an engine's page. Engines Kalsa cannot install say so instead. */
export function RunPanel(props: PanelProps) {
  const { engine } = props;
  if (!engine.install) return engine.note?.startsWith("Requires") ? <NeedsApp engine={engine} /> : <NoRecipe engine={engine} />;
  return <InstallableRun {...props} recipe={engine.install} />;
}
