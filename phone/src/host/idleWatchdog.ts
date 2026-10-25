/**
 * The decision loop of the 180-second foreground-idle dispose (PARITY-STATUS
 * gap 8), pure and timer-injected so the grace semantics are testable without
 * a device. The controller's half lives in `AppShell.tsx:3064-3315` (the
 * `idleClock` inside the background-discard effect); this is that clock with
 * one host adaptation and nothing else:
 *
 * - `bump` resets the activity timestamp and arms ONLY when no timer is
 *   pending (controller `App:3311-3314` — a pending fire is not restarted;
 *   it re-checks `idleMs` and re-arms). Every arm schedules the FULL
 *   `FOREGROUND_IDLE_DISPOSE_MS` window again, so disposal can lag the real
 *   idle by up to one window — the controller's sampling design, kept.
 * - a fire that fails `shouldRunForegroundIdleDispose` re-arms (the gate is
 *   the controller's own: quiet idle at the limit, engine ready, and — for a
 *   live turn — only past `FOREGROUND_DECODE_SILENCE_MS` of RAW-token
 *   silence, so a pre-first-token turn is never app-disposed);
 * - a discard that comes back `skipped` re-arms (the controller arms inside
 *   `skipDisposeWhileInFlight`, the `newer_gen` plan and the in-flight
 *   discard guard — all three land here as `skipped`);
 * - a discard that ENDS the clock (disposed, or threw — the controller's
 *   `catch` also leaves it unarmed) does not re-arm; the next user-activity
 *   bump starts it again.
 *
 * The host-only rule: the clock never disposes outside the foreground. The
 * controller could fire while backgrounded because its background machine
 * had already disposed (engine not ready → gate refuses); this host mounts
 * no background discard and no background grace (`App:3026-3526` stays with
 * the controller), so a background fire only re-arms — an idle dispose is a
 * FOREGROUND governor and must not become an ungraced background unload.
 */
import {
  FOREGROUND_IDLE_DISPOSE_MS,
  shouldRunForegroundIdleDispose,
} from "../app/foregroundIdleDispose";

export interface IdleClockReader {
  engineReady: boolean;
  inFlight: boolean;
  tokenSilenceMs?: number;
}

export interface ForegroundIdleClockDeps<H> {
  now: () => number;
  schedule: (run: () => void, delayMs: number) => H;
  cancel: (handle: H) => void;
  isForeground: () => boolean;
  read: () => IdleClockReader;
  /**
   * One discard attempt. `skipped` → the clock re-arms; anything else ends
   * the clock until the next bump (controller parity: success and thrown
   * disposal both leave it unarmed). `ageNow` reports the live idle age at
   * call time — the controller's `model.unload` line logs
   * `Date.now() - lastUserActivityAt` when the dispose actually lands
   * (`App:3129-3131`), after the drain, not the age the fire started with.
   */
  discard: (ageNow: () => number) => Promise<"ended" | "skipped">;
  /** Fired when a live turn's RAW-token silence passes the gate — the
   *  controller's `KALSA_IDLE_STALL` line, kept identical (campaign greps
   *  `scripts/campaign/verdict.mjs` counts it). */
  onStallAttempt?: (idleMs: number, tokenSilenceMs: number | undefined) => void;
}

export interface ForegroundIdleClock<H> {
  /** User activity: reset the timestamp, arm if nothing is pending. */
  bump: () => void;
  /** Unmount: cancel the pending fire and stop scheduling. */
  clear: () => void;
}

export function createForegroundIdleClock<H>(
  deps: ForegroundIdleClockDeps<H>,
): ForegroundIdleClock<H> {
  let lastUserActivityAt = deps.now();
  let timer: H | null = null;
  let discardRunning = false;

  const fire = (): void => {
    timer = null;
    const idleMs = deps.now() - lastUserActivityAt;
    const { engineReady, inFlight, tokenSilenceMs } = deps.read();
    if (
      deps.isForeground() &&
      !discardRunning &&
      shouldRunForegroundIdleDispose({ engineReady, inFlight, idleMs, tokenSilenceMs })
    ) {
      if (inFlight) {
        deps.onStallAttempt?.(idleMs, tokenSilenceMs);
      }
      discardRunning = true;
      const settle = () => {
        discardRunning = false;
      };
      void deps.discard(() => deps.now() - lastUserActivityAt).then((outcome) => {
        settle();
        if (outcome === "skipped") arm();
      }, () => {
        // The controller's `catch {}` also ends here: no re-arm, no throw.
        settle();
      });
      return;
    }
    arm();
  };

  const arm = (): void => {
    if (timer !== null) deps.cancel(timer);
    timer = deps.schedule(fire, FOREGROUND_IDLE_DISPOSE_MS);
  };

  return {
    bump: () => {
      lastUserActivityAt = deps.now();
      if (timer === null) arm();
    },
    clear: () => {
      if (timer !== null) deps.cancel(timer);
      timer = null;
    },
  };
}
