import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/Icon";
import { Openable } from "../../components/Openable";
import { RunPanel } from "./run/RunPanel";
import { EngineBadge, reviewText } from "./EngineBadge";
import { authorName, fmt, hardwareText, notForText, runsOnMac } from "./model";
import type { Benchmark, Engine, EnginesView, Pick } from "./types";

const BEFORE: [IconName, string, string][] = [
  ["download", "What is downloaded, and from where", "The official release or package of the project — one pinned version, checked against its checksum. Nothing from other websites."],
  ["folder", "Where it goes", "Its own folder under ~/Library/Application Support/Kalsa/engines/. Nothing is placed anywhere else."],
  ["users", "Who it runs as", "It runs as you, with access to your files. macOS does not sandbox it, so install only what you trust."],
  ["lock", "Who can reach it", "Kalsa starts it on 127.0.0.1 only. Other devices on your network cannot connect."],
  ["trash", "Uninstall", "Removing it deletes that folder."],
];

function BenchCard({
  benchmark,
  tag,
  figure,
  chipLabel,
}: {
  benchmark: Benchmark;
  tag: string;
  figure: string | null;
  chipLabel: string | null;
}) {
  const same = benchmark.chipTag === tag;
  const metrics: [number, "decode" | "prefill", number | null][] = [];
  if (benchmark.decodeTokS !== null) {
    metrics.push([benchmark.decodeTokS, "decode", benchmark.baselineDecodeTokS]);
  }
  if (benchmark.prefillTokS !== null) {
    metrics.push([benchmark.prefillTokS, "prefill", benchmark.baselinePrefillTokS]);
  }
  return (
    <div className={`eg-bc${same ? " s" : " w"}`}>
      <div className="eg-bt">
        <span className="eg-claimed">Claimed by the author</span>
        <span className={`eg-lab ${same ? "same" : "weak"}`}>
          {same ? "Same chip as yours" : `Measured on ${chipLabel ?? "other hardware"}, not your chip`}
        </span>
      </div>
      <div className="eg-bm">
        {benchmark.model} <span>{benchmark.quant === "unstated" ? "quant not stated" : benchmark.quant}</span>
      </div>
      <div className="eg-nums">
        {metrics.length ? metrics.map(([value, metric, baseline]) => (
          <div key={metric}>
            <span className="big num">{fmt(value)}</span>
            <span className="u">tok/s {metric}{figure?.startsWith("prefill") && metric === "prefill" ? " (no decode figure)" : ""}</span>
            <span className="vsx num">
              {benchmark.gains[metric] ? (
                <b className={benchmark.gains[metric]?.noise ? "eg-noise" : undefined}>
                  {benchmark.gains[metric]?.gainLabel}{benchmark.gains[metric]?.noise ? ", within noise" : ""}
                </b>
              ) : null}
              {"vs "}{baseline === null ? "no baseline" : fmt(baseline)} on {benchmark.baseline}
            </span>
          </div>
        )) : (
          <div>
            <span className="big num">{fmt(benchmark.baselineDecodeTokS ?? benchmark.baselinePrefillTokS ?? 0)}</span>
            <span className="u">tok/s, {benchmark.baseline}</span>
          </div>
        )}
      </div>
      <div className="eg-slot"><span>Your Mac</span><span>not measured yet</span></div>
      <div className="mc">
        {benchmark.machine}
        {benchmark.note ? <><br />{benchmark.note}</> : null}
        <br />
        <Openable url={benchmark.source}>{benchmark.source.replace("https://", "")}</Openable>
      </div>
    </div>
  );
}

/** The engine's own product page: credit, published numbers and install facts. */
export function EngineDetail({ view, engine, picks, onOpenChat }: { view: EnginesView; engine: Engine; picks: Pick[]; onOpenChat: (engineId: string) => void }) {
  const runs = runsOnMac(engine, view.machine.chipTag);
  const pick = picks.find((row) => row.engineId === engine.id);
  const relation = engine.upstream
    ? `${engine.kind === "fork" ? "Fork of" : "Built on"} ${engine.upstream}`
    : engine.kind === "reference" ? "Reference" : "Engine";
  const mtplx: [IconName, string, string] = [
    "layoutGrid",
    "Install the MTPLX app first",
    "This build needs the upstream MTPLX app (it provides the mtplx.cli serve command). Kalsa will not install that for you — it will tell you when it is missing.",
  ];
  const facts = engine.note?.startsWith("Requires the upstream MTPLX app") ? [mtplx, ...BEFORE] : BEFORE;

  return (
    <div className="eg-page eg-detail">
      {!runs ? (
        <div className="eg-banner">
          <Icon name="info" size={18} />
          <div><b>This one doesn’t run on this Mac.</b><br />{notForText(engine, view.machine.chipTag)}. The numbers below are for reference; Install is off.</div>
        </div>
      ) : null}
      {!engine.recommendable ? (
        <div className="eg-banner">
          <Icon name="info" size={18} />
          <div><b>Not recommended.</b><br />{engine.note?.replace("Not recommendable: ", "")}</div>
        </div>
      ) : null}
      <h1>{engine.name}</h1>
      <p className="eg-credit">
        <EngineBadge reviewed={engine.reviewed} /> Made by <b>{authorName(engine)}</b> at github.com/{engine.repo}. {engine.summary}.
      </p>
      <div className="eg-acts">
        <Openable className="eg-btn2" url={`https://github.com/${engine.repo}`}>
          <Icon name="link" size={15} />GitHub
        </Openable>
      </div>
      {runs ? <RunPanel engine={engine} ramBytes={view.machine.ramBytes} onOpenChat={onOpenChat} /> : null}
      <div className="eg-stats">
        <div><b>{engine.license}</b><span>Licence</span></div>
        <div><b>{relation}</b><span>{engine.upstream ? "Upstream" : "Kind"}</span></div>
        <div><b>{hardwareText(engine.hardware).join(", ")}</b><span>Runs on</span></div>
      </div>
      <h2 className="eg-h2">Kalsa review</h2>
      <div className="eg-review"><p>{reviewText(engine.reviewed)}</p></div>
      <h2 className="eg-h2">Published benchmarks<small>from the author’s README; Kalsa has not re-run them</small></h2>
      {engine.benchmark.length ? (
        <div className="eg-benches">
          {engine.benchmark.map((benchmark, index) => {
            const isPick = pick?.benchmark?.source === benchmark.source
              && pick.benchmark.model === benchmark.model
              && (pick.benchmark.decodeTokS ?? null) === benchmark.decodeTokS;
            return (
              <BenchCard
                key={index}
                benchmark={benchmark}
                tag={view.machine.chipTag}
                figure={isPick ? pick?.figureLabel ?? null : null}
                chipLabel={isPick ? pick?.chipLabel ?? null : null}
              />
            );
          })}
        </div>
      ) : (
        <div className="eg-refbox">
          A reference engine is the baseline other engines are measured against, so it has no comparison of its own.
          Install it to see what your Mac does with it.
        </div>
      )}
      <h2 className="eg-h2">Before you install</h2>
      <div className="eg-group">
        {facts.map(([icon, title, body]) => (
          <div className="eg-gr" key={title}>
            <Icon name={icon} size={18} />
            <b>{title}</b>
            <p>{body}</p>
          </div>
        ))}
      </div>
      <h2 className="eg-h2">Made by</h2>
      <div className="eg-made">
        <div><b>{authorName(engine)}</b><span>github.com/{engine.repo}</span></div>
        <Openable className="eg-btn3" url={`https://github.com/${engine.repo}`}>
          <Icon name="link" size={14} />GitHub
        </Openable>
      </div>
    </div>
  );
}
