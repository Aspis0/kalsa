import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Openable } from "../../../components/Openable";
import { authorName, isOrganisation } from "../model";
import type { Engine, InstallRecipe } from "../types";
import { engineFolder, megabytes, shortSha } from "./format";

/** A sheet over the whole window: Escape and the scrim cancel, and focus starts on the safe button. */
function Sheet({ title, lede, onCancel, children, foot }: { title: string; lede: string; onCancel: () => void; children?: ReactNode; foot: ReactNode }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="run-scrim" onClick={onCancel}>
      <div className="run-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="run-lede">{lede}</p>
        {children}
        <div className="run-foot">
          <button type="button" ref={cancel} className="run-btn sec" onClick={onCancel}>Cancel</button>
          {foot}
        </div>
      </div>
    </div>
  );
}

function downloadRows(recipe: InstallRecipe): [string, ReactNode][] {
  if (recipe.kind === "release-archive") {
    return [
      ["Downloaded", <><b>{recipe.url.split("/").pop()}</b>, {megabytes(recipe.size)}<br /><code>{recipe.url}</code></>],
      ["Version", <>release {recipe.tag}, checked against sha256 <code>{shortSha(recipe.sha256)}</code> before it is used</>],
    ];
  }
  const page = `https://pypi.org/project/${recipe.package}/${recipe.version}/`;
  return [
    ["Downloaded", <><b>{recipe.package} {recipe.version}</b> and its locked packages<br /><code>{page}</code><br />Installed into its own Python {recipe.python} environment with uv, from a lock file.</>],
    ["Version", <>{recipe.version}, every package checked by hash before it is used</>],
  ];
}

export function InstallSheet({ engine, recipe, onCancel, onInstall }: { engine: Engine; recipe: InstallRecipe; onCancel: () => void; onInstall: () => void }) {
  const author = `${authorName(engine)}${isOrganisation(engine) ? " (organisation)" : ""}`;
  return (
    <Sheet
      title={`Install ${engine.name}?`}
      lede="Read this first. Nothing is installed until you choose Install."
      onCancel={onCancel}
      foot={<button type="button" className="run-btn" onClick={onInstall}>Install</button>}
    >
      <dl className="run-kv">
        <dt>Written by</dt><dd><b>{author}</b>, github.com/{engine.repo}</dd>
        <dt>Licence</dt><dd>{engine.license}</dd>
        {downloadRows(recipe).flatMap(([label, value]) => [<dt key={`t${label}`}>{label}</dt>, <dd key={`d${label}`}>{value}</dd>])}
        <dt>Goes into</dt><dd><code>{engineFolder(engine.id)}</code></dd>
        <dt>Runs as</dt><dd>You, with access to your files. macOS does not sandbox it.</dd>
        <dt>Who can reach it</dt><dd>Only this Mac. Kalsa starts it on 127.0.0.1.</dd>
        <dt>Uninstall</dt><dd>Deletes that folder.</dd>
      </dl>
      <p className="run-fine"><Openable url={`https://github.com/${engine.repo}`}>See the project on GitHub</Openable></p>
    </Sheet>
  );
}

export function UninstallSheet({ engine, onCancel, onUninstall }: { engine: Engine; onCancel: () => void; onUninstall: () => void }) {
  return (
    <Sheet
      title={`Uninstall ${engine.name}?`}
      lede={`This deletes ${engineFolder(engine.id)} and everything in it. Nothing else on your Mac is touched. You can install it again later.`}
      onCancel={onCancel}
      foot={<button type="button" className="run-btn danger" onClick={onUninstall}>Uninstall</button>}
    />
  );
}
