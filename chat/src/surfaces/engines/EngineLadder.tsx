import { EngineBadge } from "./EngineBadge";
import { authorName, notForText, runsOnMac, fmt } from "./model";
import type { Benchmark, EnginesView, Engine, Pick } from "./types";

const TICKS = [1, 1.5, 2, 2.5];
const SCALE = 2.6;
const position = (gain: number): number => Math.min(100, (Math.log(gain) / Math.log(SCALE)) * 100);

/** "decode +1%, within noise · prefill +35%": every figure Rust worked out, a small one muted. */
function GainLabels({ benchmark }: { benchmark: Benchmark }) {
  const shown = [benchmark.gains.decode, benchmark.gains.prefill].flatMap((gain) => (gain ? [gain] : []));
  return (
    <>
      {shown.map((gain, index) => (
        <span key={gain.label}>
          {index > 0 ? " · " : ""}
          <span className={gain.noise ? "eg-noise" : undefined}>{gain.label}</span>
        </span>
      ))}
      {" vs "}{benchmark.baseline}
    </>
  );
}

function LadderRow({
  pick,
  engine,
  runs,
  tag,
  onOpen,
}: {
  pick: Pick;
  engine: Engine;
  runs: boolean;
  tag: string;
  onOpen: (id: string) => void;
}) {
  const benchmark = pick.benchmark;
  const sub = runs
    ? `${authorName(engine)}${engine.upstream ? `, ${engine.kind === "fork" ? "fork of" : "built on"} ${engine.upstream}` : ""}`
    : notForText(engine, tag);
  const quiet = !pick.recommendable;
  const plot = quiet || !pick.gain || !benchmark ? (
    <div className="eg-pl2">
      {quiet ? `Not recommended: ${engine.note ?? ""}`
        : !runs ? notForText(engine, tag)
          : engine.kind === "reference" ? "The baseline others are measured against" : pick.reason}
    </div>
  ) : (
    <span className={`eg-plot${pick.sameChip ? "" : " weak"}${pick.gain > SCALE ? " clip" : ""}`}>
      {TICKS.map((tick) => <i key={tick} className="g" style={{ left: `${position(tick)}%` }} />)}
      <i className="span" style={{ width: `${position(pick.gain)}%` }} />
      <i className="a" />
      <i className="b" style={{ left: `${position(pick.gain)}%` }} />
    </span>
  );
  const value = quiet ? (
    <span className="eg-xc t"><b>Not recommended</b></span>
  ) : pick.gain ? (
    <span className={`eg-xc ${pick.sameChip ? "s" : "w"}`}>
      <b className={`num${(benchmark?.gains.decode ?? benchmark?.gains.prefill)?.noise ? " eg-noise" : ""}`}>{pick.gainLabel}</b>
      <span className={`eg-lab ${pick.sameChip ? "same" : "weak"}`}>
        {pick.sameChip ? "Same chip" : `Measured on ${pick.chipLabel ?? "other hardware"}`}
      </span>
      <span className="eg-claimed sm">Claimed by the author</span>
      <span className="eg-vs">{benchmark ? <GainLabels benchmark={benchmark} /> : null}</span>
    </span>
  ) : (
    <span className="eg-xc t"><b>{!runs ? notForText(engine, tag) : ""}</b></span>
  );
  return (
    <button type="button" className={`eg-lr${runs ? "" : " off"}`} onClick={() => onOpen(engine.id)}>
      <span className="eg-nm">
        <b>{engine.name}</b>
        <span><EngineBadge reviewed={engine.reviewed} /> {sub}</span>
      </span>
      {plot}
      {value}
    </button>
  );
}

function Hero({
  pick,
  engine,
  onOpen,
}: {
  pick: Pick;
  engine: Engine;
  onOpen: (id: string) => void;
}) {
  const benchmark = pick.benchmark!;
  const at = position(pick.gain ?? 1);
  const measured = benchmark.machine.split(",")[0];
  return (
    <div className="eg-feat">
      <div>
        <div className="k">Recommended for this Mac</div>
        <h2>{engine.name}</h2>
        <div className="by">
          <EngineBadge reviewed={engine.reviewed} /> {authorName(engine)}, {engine.license}
          {engine.kind === "fork" && engine.upstream ? `, fork of ${engine.upstream}` : ""}
        </div>
        <p className="why">
          <b>Measured on {measured}</b>, the same chip as yours.
          {engine.note?.startsWith("Requires") ? ` ${engine.note}` : ""}
        </p>
        <div className="eg-fa">
          <button type="button" className="eg-pill" onClick={() => onOpen(engine.id)}>Review and install</button>
          <span className="cl">Claimed by the author. Not measured on your Mac yet.</span>
        </div>
      </div>
      <div className="xx">
        <span className="n num">{pick.gainLabel}</span>
        <span className="d">
          <b className="num">{fmt(benchmark.decodeTokS ?? benchmark.prefillTokS ?? 0)}</b>
          {" vs "}<span className="num">{fmt(benchmark.baselineDecodeTokS ?? benchmark.baselinePrefillTokS ?? 0)}</span>
          {" tok/s "}{pick.metric ?? "result"}
          <br />{benchmark.model}
        </span>
      </div>
      <div className="eg-hp">
        <i className="track" />
        <i className="span" style={{ width: `${at}%` }} />
        <i className="a" />
        <i className="b" style={{ left: `${at}%` }} />
        <span className="la">
          <b className="num">{fmt(benchmark.baselineDecodeTokS ?? benchmark.baselinePrefillTokS ?? 0)}</b>
          {" "}{benchmark.baseline}
        </span>
        <span className="lb" style={{ left: `${at}%` }}>
          <b className="num">{fmt(benchmark.decodeTokS ?? benchmark.prefillTokS ?? 0)}</b>
          {" this engine, "}{measured}
        </span>
      </div>
    </div>
  );
}

const KEY = (
  <div className="eg-key">
    <span><i className="eg-dot base" />baseline the author chose</span>
    <span><i className="eg-dot" />engine, measured on your chip</span>
    <span><i className="eg-dot hol" />engine, measured on another chip: weaker evidence</span>
  </div>
);

const AXIS = (
  <div className="eg-axis">
    <span>Times faster than the author’s own baseline</span>
    <div className="eg-ticks">{TICKS.map((tick) => <span key={tick} style={{ left: `${position(tick)}%` }}>{tick}×</span>)}</div>
    <span />
  </div>
);

/** A list of ranked rows, optionally led by the same-chip hero. */
export function EngineLadder({
  view,
  picks,
  engines,
  hero,
  heading,
  note,
  count,
  showAxis,
  onOpen,
}: {
  view: EnginesView;
  picks: Pick[];
  engines: Engine[];
  hero?: boolean;
  heading: string;
  note?: string;
  count?: number;
  showAxis?: boolean;
  onOpen: (id: string) => void;
}) {
  const byId = new Map(view.engines.map((engine) => [engine.id, engine]));
  // The hero is only ever the top Rust pick, and only on the exact machine.
  const showHero = hero && picks[0]?.sameChip === true && picks[0].exactMachine === true;
  const rows = showHero ? picks.slice(1) : picks;
  return (
    <>
      {showHero && picks[0] ? <Hero pick={picks[0]} engine={byId.get(picks[0].engineId)!} onOpen={onOpen} /> : null}
      <h2 className="eg-h2">
        {heading}
        {note ? <small>{note}</small> : null}
        {count !== undefined ? <small className="num">{count}</small> : null}
      </h2>
      {showAxis === false ? null : <>{KEY}{AXIS}</>}
      <div className="eg-lad">
        {rows.map((pick) => {
          const engine = byId.get(pick.engineId);
          if (!engine || !engines.some((row) => row.id === engine.id)) return null;
          return (
            <LadderRow
              key={pick.engineId}
              pick={pick}
              engine={engine}
              runs={runsOnMac(engine, view.machine.chipTag)}
              tag={view.machine.chipTag}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </>
  );
}
