import { Openable } from "../../../components/Openable";
import type { Engine } from "../types";
import { RunCard } from "./RunCard";

/** An engine Kalsa cannot install yet. It says so calmly and points to the project's own instructions. */
export function NoRecipe({ engine }: { engine: Engine }) {
  return (
    <RunCard
      dot="ring"
      label="Install not available in Kalsa yet"
      actions={<Openable className="run-btn sec" url={`https://github.com/${engine.repo}`}>GitHub</Openable>}
    >
      <p className="run-plain">
        {engine.name} has no install recipe in Kalsa yet. See the project’s own instructions on its GitHub page to install it yourself.
        Kalsa can only install llama.cpp and mlx-lm today.
      </p>
    </RunCard>
  );
}

/** A build that runs on top of another app Kalsa does not install. */
export function NeedsApp({ engine }: { engine: Engine }) {
  const upstream = engine.upstream ?? engine.repo;
  return (
    <RunCard dot="ring" label="Requires MTPLX" sub="The MTPLX app has to be on this Mac first" actions={<button type="button" className="run-btn" disabled>Install</button>}>
      <ul className="run-steps">
        <li className="now"><span className="run-step-i" aria-hidden="true" />Install the MTPLX app first, from its own project</li>
        <li><span className="run-step-i" aria-hidden="true" />It provides the <code>mtplx.cli serve</code> command this build runs on</li>
        <li><span className="run-step-i" aria-hidden="true" />Then Kalsa can install and start this build</li>
      </ul>
      <div className="run-acts">
        <Openable className="run-btn sec" url={`https://github.com/${upstream}`}>MTPLX on GitHub</Openable>
      </div>
      <p className="run-hint">Kalsa does not install the MTPLX app for you, and installing this build is not available yet.</p>
    </RunCard>
  );
}
