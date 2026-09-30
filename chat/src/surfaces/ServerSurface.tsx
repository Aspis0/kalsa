import { brainWords, useBrain } from "./useBrain";
import { speedLine } from "../lib/speed";
import { SetupProgress } from "./SetupProgress";
import { useLanguage } from "../i18n/useLanguage";
import type { English } from "../i18n/en/all";
import "./surfaces.css";

function rateText(machine: English["machine"], tag: string, rate: number | undefined): string {
  // An absent rate reaches speedLine's own guard: not a number is not a
  // speed, and the sentence says so rather than the figure.
  return speedLine(machine, tag, rate ?? Number.NaN);
}

// The Power surface: one glance tells the owner whether Kalsa is on and what
// she is doing, and the cards below show only facts with a named source —
// her own measured speed and the phones connected now. While the first walk
// runs, its progress (the `brain_progress` events) replaces the body. The
// state's facts and words come from the shared hook; this page adds only
// what is its own: the stop failure and the metrics.
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
  const words = brainWords(state, heldFailure, busy, table);

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
                  <strong className="surface-metric-value">{rateText(table.machine, tag, metrics.decode_tokens_per_second)}</strong>
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
