import { brainWords, useBrain } from "./useBrain";
import { SetupProgress } from "./SetupProgress";
import "./surfaces.css";

const STOP_FAILURE = "The assistant did not turn off. Closing this window will stop it.";

function rateText(rate: number | undefined): string {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? `${rate.toFixed(1)} tokens/s`
    : "Not measured yet";
}

function phoneText(connected: boolean): string {
  return connected ? "Connected" : "Not connected";
}

// The Server surface: one glance tells the owner whether the local server is
// helping the phone, and the cards below show only facts the process produced.
// While the first walk runs, its progress (the `brain_progress` events)
// replaces the body. The state's facts and words come from the shared hook;
// this page adds only what is its own: the stop failure and the metrics.
export function ServerSurface() {
  const { state, liveStep, heldFailure, stopFailure, busy, act } = useBrain();

  const metrics = state?.metrics ?? {};
  const deviceCount = metrics.active_devices?.length ?? 0;
  const words = brainWords(state, heldFailure);

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
                  <span className="surface-metric-label">Phone</span>
                  <strong className={`surface-metric-value${deviceCount > 0 ? " is-positive" : ""}`}>
                    {phoneText(deviceCount > 0)}
                  </strong>
                  <span className="surface-metric-detail">Live connection</span>
                </div>
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
