/** Android bridge idle policy. Native tunnel state remains authoritative. */
import { logIrohBridgeDecision } from "./road";

export type IrohBackgroundAppState = {
  addEventListener(type: "change", handler: (state: string) => void): { remove(): void };
};

export const IROH_BACKGROUND_STOP_DELAY_MS = 30_000;

let tunnelCloseListener: (() => void) | null = null;
let isBound = false;

/** Called by the existing tunnel shutdown path, including late aborted dials. */
export function notifyIrohTunnelClosed(): void {
  tunnelCloseListener?.();
}

/** Install once beside the app's other process-level AppState listeners. */
export function bindIrohBackgroundStop(
  source: IrohBackgroundAppState,
  platform: string,
  stopBridge: () => Promise<boolean>,
): () => void {
  if (platform !== "android") return () => undefined;
  if (isBound) return () => undefined;
  isBound = true;

  let background = false;
  let deadlinePassed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopping: Promise<void> | null = null;
  let closeDuringStop = false;

  const attemptStop = (): void => {
    if (!background || !deadlinePassed) return;
    if (stopping !== null) {
      closeDuringStop = true;
      return;
    }
    let keptBridge = false;
    stopping = stopBridge()
      .then((stopped) => {
        logIrohBridgeDecision("background_stop", stopped ? "stopped" : "tunnels_open");
        keptBridge = !stopped;
      })
      .catch(() => {
        logIrohBridgeDecision("background_stop", "error");
        keptBridge = true;
      })
      .then(() => {
        stopping = null;
        const retry = keptBridge && closeDuringStop;
        closeDuringStop = false;
        if (retry) attemptStop();
      });
  };

  const onTunnelClosed = () => {
    if (background && deadlinePassed) attemptStop();
  };
  tunnelCloseListener = onTunnelClosed;

  const subscription = source.addEventListener("change", (state) => {
    if (state === "background") {
      if (background) return;
      background = true;
      deadlinePassed = false;
      timer = setTimeout(() => {
        timer = null;
        deadlinePassed = true;
        attemptStop();
      }, IROH_BACKGROUND_STOP_DELAY_MS);
    } else if (state === "active") {
      background = false;
      deadlinePassed = false;
      closeDuringStop = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  });

  return () => {
    subscription.remove();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (tunnelCloseListener === onTunnelClosed) {
      tunnelCloseListener = null;
      isBound = false;
    }
  };
}
