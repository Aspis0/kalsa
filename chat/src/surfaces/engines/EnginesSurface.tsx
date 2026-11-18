import { useEffect, useMemo, useState } from "react";
import { available, invoke } from "../../lib/tauri";
import { EngineDetail } from "./EngineDetail";
import { EngineLadder } from "./EngineLadder";
import { EngineSidebar } from "./EngineSidebar";
import { EngineToolbar } from "./EngineToolbar";
import { emptyFilter, notForText, offReasonCounts, runsOnMac, visibleEngines, VIEWS, type FilterState, type ViewKey } from "./model";
import type { EnginesView, Engine, Pick } from "./types";
import "./engines.css";

function blankPick(engine: Engine, tag: string): Pick {
  return {
    engineId: engine.id,
    benchmark: null,
    reason: notForText(engine, tag),
    sameChip: false,
    exactMachine: false,
    metric: null,
    figureLabel: null,
    gain: null,
    gainLabel: null,
    chipLabel: null,
    recommendable: engine.recommendable,
  };
}

export function EnginesSurface() {
  const [data, setData] = useState<EnginesView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<ViewKey>("rec");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(emptyFilter);

  useEffect(() => {
    if (!available()) {
      setFailure("Open Kalsa to see the engine catalog for this Mac.");
      return;
    }
    let live = true;
    invoke<EnginesView>("engines_view")
      .then((answer) => {
        if (live) setData(answer);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const licenses = useMemo(
    () => [...new Set(data?.engines.map((engine) => engine.license) ?? [])].sort(),
    [data],
  );

  if (failure) {
    return <div className="eg-shell"><div className="eg-page"><p>{failure}</p></div></div>;
  }
  if (!data) return <div className="eg-shell" aria-busy="true" />;

  const tag = data.machine.chipTag;
  const pickFor = (engine: Engine): Pick =>
    data.picks.find((pick) => pick.engineId === engine.id) ?? blankPick(engine, tag);
  const detail = data.engines.find((engine) => engine.id === selected);
  const onOpenView = (key: ViewKey) => {
    setViewKey(key);
    setSelected(null);
  };

  let body;
  if (detail) {
    body = <EngineDetail view={data} engine={detail} picks={data.picks} />;
  } else {
    const home = viewKey === "rec" && !filter.query && filter.sort === "rank" && filter.license === "all";
    const shown = visibleEngines(data, viewKey, filter);
    const title = filter.query ? "Results" : VIEWS[viewKey].title;
    const subtitle = home
      ? `Ranked for ${data.machine.chipName} from numbers the authors published. Nothing has been measured on this Mac yet.`
      : `${shown.length} of ${data.engines.length} engines`;

    if (!shown.length) {
      body = (
        <>
          <h1 className="eg-h1">{title}</h1>
          <div className="eg-empty">
            <b>No engine matches</b>
            Try another search or filter.
            <br />
            <button type="button" onClick={() => setFilter(emptyFilter())}>Clear search and filters</button>
          </div>
        </>
      );
    } else if (home) {
      const top = data.picks.slice(0, 3);
      const heroOk = top[0]?.sameChip === true && top[0].exactMachine === true;
      // The weaker-evidence note is true only when no row in this section is on your chip.
      const sectionRows = heroOk ? top.slice(1) : top;
      const allCrossChip = sectionRows.length > 0 && sectionRows.every((pick) => !pick.sameChip);
      const more = data.picks
        .slice(3)
        .filter((pick) => {
          const engine = data.engines.find((row) => row.id === pick.engineId);
          return engine ? runsOnMac(engine, tag) : false;
        });
      const reasons = offReasonCounts(data);
      body = (
        <>
          <h1 className="eg-h1">{title}</h1>
          <p className="eg-sub">{subtitle}</p>
          <EngineLadder
            view={data}
            picks={top}
            engines={shown}
            hero={heroOk}
            heading={heroOk ? "Also recommended" : "Recommended"}
            note={allCrossChip ? "measured on a different chip than yours, so weaker evidence" : undefined}
            onOpen={setSelected}
          />
          <EngineLadder
            view={data}
            picks={more}
            engines={shown}
            heading="More that run on this Mac"
            count={more.length}
            showAxis={false}
            onOpen={setSelected}
          />
          <div className="eg-more">
            <span>{reasons.vendor} built for other hardware, {reasons.apple} need other Apple chips.</span>
            <button type="button" onClick={() => onOpenView("off")}>See why they don’t run here</button>
          </div>
        </>
      );
    } else {
      body = (
        <>
          <h1 className="eg-h1">{title}</h1>
          <p className="eg-sub">{subtitle}</p>
          <EngineLadder
            view={data}
            picks={shown.map(pickFor)}
            engines={shown}
            heading={VIEWS[viewKey].title}
            count={shown.length}
            onOpen={setSelected}
          />
        </>
      );
    }
  }

  return (
    <div className="eg-shell">
      <EngineSidebar view={data} current={viewKey} onOpen={onOpenView} />
      <div className="eg-main">
        <EngineToolbar
          detail={detail !== undefined}
          detailTitle={detail?.name ?? ""}
          filter={filter}
          view={data}
          licenses={licenses}
          onFilter={setFilter}
          onBack={() => setSelected(null)}
        />
        <div className="eg-scroll">{detail ? body : <div className="eg-page">{body}</div>}</div>
      </div>
    </div>
  );
}
