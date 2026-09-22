import { brainWords, STOP_FAILURE, useBrain } from "./useBrain";
import { tierRows } from "../lib/tierPanel";
import { SetupProgress } from "./SetupProgress";
import "./surfaces.css";

function rateText(rate: number | undefined): string {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? `${rate.toFixed(1)} tokens/s`
    : "Not measured yet";
}

function connectedText(connected: boolean): string {
  return connected ? "Connected" : "Not connected";
}

// The Server surface: one glance tells the owner whether the local server is on
// and what it is doing, and the cards below show only facts the process
// produced — the server's own rates, and the disk tier's numbers as the door
// read them (`tierRows`: residents over the door's capacity, the directory
// scan). While the first walk runs, its progress (the `brain_progress`
// events) replaces the body. The state's facts and words come from the shared
// hook; this page adds only what is its own: the stop failure and the metrics.
export function ServerSurface() {
  const { state, liveStep, heldFailure, stopFailure, busy, act } = useBrain();

  const metrics = state?.metrics ?? {};
  // A phone, not this computer: the host's own chat runs through the same
  // door, and "Connected" must not light up because the owner is typing here.
  const deviceCount = (metrics.active_devices ?? []).filter(
    (device) => device.kind !== "host",
  ).length;
  const words = brainWords(state, heldFailure, busy);

  return (
    <div className="surface-page">
      <p className="surface-eyebrow">STATUS</p>
      {liveStep ? (
        <SetupProgress step={liveStep} />
      ) : (
        <>
          <p className="surface-verdict">{words.headline}</p>
          <p className="surface-sentence">{stopFailure ? STOP_FAILURE : words.sentence}</p>
          {words.running ? (
            <>
              <div className="surface-metrics">
                <div className="surface-metric">
                  <span className="surface-metric-label">Decode</span>
                  <strong className="surface-metric-value">{rateText(metrics.decode_tokens_per_second)}</strong>
                  <span className="surface-metric-detail">Measured by the server</span>
                </div>
                <div className="surface-metric">
                  <span className="surface-metric-label">Devices</span>
                  <strong className={`surface-metric-value${deviceCount > 0 ? " is-positive" : ""}`}>
                    {connectedText(deviceCount > 0)}
                  </strong>
                  <span className="surface-metric-detail">Live connection</span>
                </div>
                {/* The tier's own rows, only while the door answers: no tier
                    block means no rows — and no concurrency row at all, since
                    that number has no committed measurement yet. */}
                {tierRows(metrics.tier).map((row) => (
                  <div className="surface-metric" key={row.label}>
                    <span className="surface-metric-label">{row.label}</span>
                    <strong className="surface-metric-value">{row.value}</strong>
                    <span className="surface-metric-detail">{row.detail}</span>
                  </div>
                ))}
              </div>
              {metrics.throttled === true ? (
                <p className="surface-note">
                  This computer is running slower on purpose, to protect itself. Answers take longer than usual.
                </p>
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
