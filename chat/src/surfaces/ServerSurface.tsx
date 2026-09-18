import { useCallback, useEffect, useRef, useState } from "react";
import { available, invoke, listen } from "../lib/tauri";
import { SetupProgress, type ProgressStep } from "./SetupProgress";
import "./surfaces.css";

const POLL_MS = 1000;
const STOP_FAILURE = "The assistant did not turn off. Closing this window will stop it.";
const COULD_NOT_TELL =
  "This page could not tell whether the assistant is running. Trying again usually works.";

/** What `brain_state` answers: the server's own account of itself. */
interface BrainState {
  kind: "stopped" | "starting" | "running" | "failed";
  reason?: string;
  metrics?: {
    decode_tokens_per_second?: number;
    active_devices?: unknown[];
    throttled?: boolean;
  };
}

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
// replaces the body.
export function ServerSurface() {
  const [state, setState] = useState<BrainState | null>(null);
  // A start that failed keeps its own sentence on the page against the poll,
  // until a start actually succeeds.
  const [heldFailure, setHeldFailure] = useState<string | null>(null);
  const heldFailureRef = useRef<string | null>(null);
  // A stop that failed says so for as long as it takes the next read to land.
  const [stopFailure, setStopFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  // The latest walk step, live. It is cleared — never shown stale — the
  // moment the read stops saying "stopped".
  const [liveStep, setLiveStep] = useState<ProgressStep | null>(null);

  function holdFailure(value: string | null): void {
    heldFailureRef.current = value;
    setHeldFailure(value);
  }

  const refresh = useCallback(async (): Promise<void> => {
    let next: BrainState | null = null;
    if (available()) {
      try {
        next = await invoke<BrainState>("brain_state");
      } catch {
        next = null;
      }
    }
    setState(next);
    setStopFailure(false);
    // The walk lives only while the read still says stopped and no start
    // failure is held; otherwise the ordinary view takes the page back.
    if (!next || next.kind !== "stopped" || heldFailureRef.current) setLiveStep(null);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // The subscription is async: if the surface unmounts before the bus
  // answers, the unsubscribe still runs.
  useEffect(() => {
    let off: (() => void) | null = null;
    let live = true;
    void listen("brain_progress", (step: unknown) => {
      setLiveStep((step as ProgressStep) || null);
      void refresh();
    }).then((unsubscribe) => {
      if (live) off = unsubscribe;
      else unsubscribe();
    });
    return () => {
      live = false;
      if (off) off();
    };
  }, [refresh]);

  async function act(): Promise<void> {
    if (!state) {
      void refresh();
      return;
    }
    setBusy(true);
    try {
      if (state.kind === "stopped" || state.kind === "failed") {
        await invoke("brain_start");
        holdFailure(null);
      } else {
        await invoke("brain_stop");
      }
    } catch (error) {
      if (state.kind === "stopped" || state.kind === "failed") {
        holdFailure(String(error));
      } else {
        setStopFailure(true);
      }
    }
    setBusy(false);
    void refresh();
  }

  const metrics = state?.metrics ?? {};
  const deviceCount = metrics.active_devices?.length ?? 0;
  const running = state?.kind === "running";

  let headline: string;
  let sentence: string;
  let button: string;
  let enabled: boolean;
  if (!state) {
    headline = "Not known";
    sentence = COULD_NOT_TELL;
    button = "Try again";
    enabled = true;
  } else {
    switch (state.kind) {
      case "stopped":
        headline = heldFailure ? "Stopped" : "Off";
        sentence = heldFailure ?? "This computer is not helping your phone right now.";
        button = heldFailure ? "Try again" : "Turn on";
        enabled = true;
        break;
      case "starting":
        headline = "Starting";
        sentence = "Getting ready. On an older computer this can take a minute.";
        button = "Starting";
        enabled = false;
        break;
      case "running":
        headline = "On";
        sentence =
          deviceCount > 0 ? "Your phone is using this computer right now." : "This computer is ready for your phone.";
        button = "Turn off";
        enabled = true;
        break;
      case "failed":
        headline = "Stopped";
        sentence = state.reason ?? "";
        button = "Try again";
        enabled = true;
        break;
      default:
        headline = "Not known";
        sentence = COULD_NOT_TELL;
        button = "Try again";
        enabled = true;
    }
  }

  return (
    <div className="surface-page">
      <p className="surface-eyebrow">STATUS</p>
      {liveStep ? (
        <SetupProgress step={liveStep} />
      ) : (
        <>
          <p className="surface-verdict">{headline}</p>
          <p className="surface-sentence">{stopFailure ? STOP_FAILURE : sentence}</p>
          {running ? (
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
            <button type="button" className="btn-primary" disabled={!enabled || busy} onClick={() => void act()}>
              {button}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
