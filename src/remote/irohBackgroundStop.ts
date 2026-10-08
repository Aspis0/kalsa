/** Android bridge idle policy: background stop and foreground idle stop.
 *  Native tunnel state remains authoritative. */
import { logIrohBridgeDecision } from "./road";
import type { BackgroundTimer, TimerHandle } from "../platform/backgroundTimer";

export type IrohBackgroundAppState = {
  addEventListener(type: "change", handler: (state: string) => void): { remove(): void };
};

export const IROH_BACKGROUND_STOP_DELAY_MS = 30_000;
export const IROH_IDLE_STOP_DELAY_MS = 120_000;

let tunnelCloseListener: (() => void) | null = null;
let dialListener: (() => void) | null = null;
let isBound = false;

/** Called by the existing tunnel shutdown path, including late aborted dials. */
export function notifyIrohTunnelClosed(): void {
  tunnelCloseListener?.();
}

/** Called by the dial path: every dial resets the foreground idle clock. */
export function notifyIrohDial(): void {
  dialListener?.();
}

/** Install once beside the app's other process-level AppState listeners. */
export function bindIrohBackgroundStop(
  source: IrohBackgroundAppState,
  platform: string,
  stopBridge: () => Promise<boolean>,
  timerSource: BackgroundTimer,
): () => void {
  if (platform !== "android") return () => undefined;
  if (isBound) return () => undefined;
  isBound = true;

  let background = false;
  let deadlinePassed = false;
  let backgroundTimer: TimerHandle | null = null;
  let idleTimer: TimerHandle | null = null;
  let idleDue = false;
  let dialed = false;
  // Dials landing while a stop is in flight must outlive that stop.
  let dialGeneration = 0;
  let stopping: Promise<void> | null = null;
  let closeDuringStop = false;

  const attemptStop = (): void => {
    const stage = background ? "background_stop" : "idle_stop";
    const due = background ? deadlinePassed : idleDue && dialed;
    if (!due) return;
    if (stopping !== null) {
      closeDuringStop = true;
      return;
    }
    const generation = dialGeneration;
    let keptBridge = false;
    stopping = stopBridge()
      .then((stopped) => {
        logIrohBridgeDecision(stage, stopped ? "stopped" : "tunnels_open");
        keptBridge = !stopped;
        // A dial that arrived during this stop keeps its own idle window.
        if (stopped && generation === dialGeneration) dialed = false;
      })
      .catch(() => {
        logIrohBridgeDecision(stage, "error");
        keptBridge = true;
      })
      .then(() => {
        stopping = null;
        const retry = keptBridge && closeDuringStop;
        closeDuringStop = false;
        if (retry) attemptStop();
      });
  };

  const clearIdleTimer = (): void => {
    if (idleTimer !== null) timerSource.clearTimeout(idleTimer);
    idleTimer = null;
    idleDue = false;
  };

  const armIdleTimer = (): void => {
    clearIdleTimer();
    idleTimer = timerSource.setTimeout(() => {
      idleTimer = null;
      idleDue = true;
      attemptStop();
    }, IROH_IDLE_STOP_DELAY_MS);
  };

  const onDial = (): void => {
    dialGeneration += 1;
    dialed = true;
    // Background owns the clock until active re-arms it.
    if (!background) armIdleTimer();
  };

  const onTunnelClosed = () => {
    if (background) {
      attemptStop();
      return;
    }
    // Foreground close restarts the full window: stopping at the instant of
    // close would make the reconnecting dial pay a cold start.
    if (dialed) armIdleTimer();
  };
  tunnelCloseListener = onTunnelClosed;
  dialListener = onDial;

  const subscription = source.addEventListener("change", (state) => {
    if (state === "background") {
      if (background) return;
      background = true;
      deadlinePassed = false;
      clearIdleTimer();
      // RN suspends plain setTimeout while the activity is paused.
      backgroundTimer = timerSource.setTimeout(() => {
        backgroundTimer = null;
        deadlinePassed = true;
        attemptStop();
      }, IROH_BACKGROUND_STOP_DELAY_MS);
    } else if (state === "active") {
      background = false;
      deadlinePassed = false;
      closeDuringStop = false;
      if (backgroundTimer !== null) timerSource.clearTimeout(backgroundTimer);
      backgroundTimer = null;
      if (dialed) armIdleTimer();
    }
  });

  return () => {
    subscription.remove();
    if (backgroundTimer !== null) timerSource.clearTimeout(backgroundTimer);
    backgroundTimer = null;
    clearIdleTimer();
    if (tunnelCloseListener === onTunnelClosed) {
      tunnelCloseListener = null;
      dialListener = null;
      isBound = false;
    }
  };
}
