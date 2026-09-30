import { brainWords, useBrain } from "./useBrain";
import { concurrencyRow, tierRows } from "../lib/tierPanel";
import { SetupProgress } from "./SetupProgress";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";

function rateText(t: { notMeasuredYet: string; tokensPerSecond: (rate: string) => string }, tag: string, rate: number | undefined): string {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? t.tokensPerSecond(new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rate))
    : t.notMeasuredYet;
}

// The Server surface: one glance tells the owner whether the local server is on
// and what it is doing, and the cards below show only facts with a named
// source — the server's own rates, the disk tier's numbers as the door read
// them (`tierRows`: residents over the door's capacity, the directory scan),
// and the two-device concurrency figure, which carries the release artifact
// it was measured on (`concurrencyRow`: a rate, never a wall time). While
// the first walk runs, its progress (the `brain_progress`
// events) replaces the body. The state's facts and words come from the shared
// hook; this page adds only what is its own: the stop failure and the metrics.
// A first run's Turn on refuses with words that point at the home page's
// Start button — this page has no card of its own.
export function ServerSurface() {
  const { table, tag } = useLanguage();
  const t = table.server;
  const power = table.power;
  const { state, liveStep, heldFailure, stopFailure, busy, act } = useBrain();

  const metrics = state?.metrics ?? {};
  // A phone, not this computer: the host's own chat runs through the same
  // door, and "Connected" must not light up because the owner is typing here.
  const deviceCount = (metrics.active_devices ?? []).filter(
    (device) => device.kind !== "host",
  ).length;
  const words = brainWords(state, heldFailure, busy, power);
  // What the metrics grid may state: the tier's own rows, plus the
  // concurrency row — which exists only while its constant names a
  // `matched` release, so the number never travels without its artifact
  // (PLAN-DISK-TIER §9). Both live inside the `running` branch below: no
  // running server, no grid.
  const panelRows = tierRows(metrics.tier, t, tag);
  const concurrency = concurrencyRow(t);
  if (concurrency) panelRows.push(concurrency);

  return (
    <div className="surface-page">
      <p className="surface-eyebrow">{t.eyebrow}</p>
      {liveStep ? (
        <SetupProgress step={liveStep} />
      ) : (
        <>
          <p className="surface-verdict">{words.headline}</p>
          <p className="surface-sentence">{stopFailure ? power.stopFailure : words.sentence}</p>
          {words.running ? (
            <>
              <div className="surface-metrics">
                <div className="surface-metric">
                  <span className="surface-metric-label">{t.decode}</span>
                  <strong className="surface-metric-value">{rateText(t, tag, metrics.decode_tokens_per_second)}</strong>
                  <span className="surface-metric-detail">{t.measuredByServer}</span>
                </div>
                <div className="surface-metric">
                  <span className="surface-metric-label">{t.devices}</span>
                  <strong className={`surface-metric-value${deviceCount > 0 ? " is-positive" : ""}`}>
                    {deviceCount > 0 ? t.connected : t.notConnected}
                  </strong>
                  <span className="surface-metric-detail">{t.liveConnection}</span>
                </div>
                {/* The grid's rows: the tier's own (no tier block → no rows
                    at all) and the concurrency row, absent whenever the
                    measurement's status is not `matched` — the debt this row
                    owed is paid, and its gate is the provenance. */}
                {panelRows.map((row) => (
                  <div className="surface-metric" key={row.label}>
                    <span className="surface-metric-label">{row.label}</span>
                    <strong className="surface-metric-value">{row.value}</strong>
                    <span className="surface-metric-detail">{row.detail}</span>
                  </div>
                ))}
              </div>
              {metrics.throttled === true ? (
                <p className="surface-note">{t.throttled}</p>
              ) : null}
            </>
          ) : null}
          <div className="surface-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={!words.enabled || busy}
              onClick={() => void act()}
            >
              {words.button}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
