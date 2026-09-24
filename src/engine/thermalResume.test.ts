/**
 * The pause→cool→resume state machine, proved on its edges: a resume
 * brackets the episode with the listener's phases, a still-hot reading stays
 * cooling without an attempt, non-thermal pauses and stopped turns never
 * enter cooling at all, an abort mid-wait ends the episode cleanly, the
 * wall-clock bound gives up returning the paused result, and no path —
 * including a throwing refresh — ever throws into the caller (this module has
 * no error channel: persisting anything is the caller's decision).
 */
import {
  GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C,
  pauseReasonOf,
  resumeWhileCooling,
  type CoolingLoopOptions,
  type CoolingPhase,
} from "./thermalResume";

type Res = { pause_reason?: string; text?: string; tokens_cached?: number };

const paused: Res = { pause_reason: "thermal", tokens_cached: 0 };
const ok: Res = { text: "answer", tokens_cached: 12 };
const coolReading = { batt_temp_tenths_c: 355 };
const hotReading = { batt_temp_tenths_c: 412 };
const instantWait = async (): Promise<void> => undefined;

function base(over: Partial<CoolingLoopOptions<Res>> = {}): CoolingLoopOptions<Res> {
  return {
    attempt: async () => ok,
    refreshThermo: async () => coolReading,
    onCooling: () => undefined,
    isStopped: () => false,
    wait: instantWait,
    ...over,
  };
}

async function episode(over: Partial<CoolingLoopOptions<Res>> = {}) {
  const phases: CoolingPhase[] = [];
  const result = await resumeWhileCooling(
    base({ ...over, onCooling: (phase) => phases.push(phase) }),
  );
  return { phases, result };
}

describe("pauseReasonOf — the binding's typed outcome, read structurally", () => {
  it.each(["thermal", "profile", "reload"] as const)("accepts %s", (reason) => {
    expect(pauseReasonOf({ pause_reason: reason })).toBe(reason);
  });

  it("never mistakes an unknown or absent reason for a pause", () => {
    expect(pauseReasonOf({ pause_reason: "overheat" })).toBeNull();
    expect(pauseReasonOf({ pause_reason: 3 })).toBeNull();
    expect(pauseReasonOf({})).toBeNull();
    expect(pauseReasonOf(null)).toBeNull();
    expect(pauseReasonOf("thermal")).toBeNull();
  });
});

describe("resumeWhileCooling", () => {
  it("retries the same completion once the reading allows, bracketing the episode", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest.fn().mockResolvedValue(coolReading);
    const { phases, result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(refreshThermo).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["start", "wait", "resume", "end"]);
  });

  it("stays in cooling without attempting while the reading is still hot", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest
      .fn()
      .mockResolvedValueOnce(hotReading)
      .mockResolvedValueOnce(coolReading);
    const { phases, result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    // One refresh per cycle; only the allowed reading attempts.
    expect(refreshThermo).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenCalledTimes(2);
    // The first cycle is still hot: it waits again with no `resume`.
    expect(phases).toEqual(["start", "wait", "wait", "resume", "end"]);
  });

  it("leaves a non-thermal pause to the caller: no cooling, one attempt", async () => {
    const attempt = jest.fn().mockResolvedValue({ pause_reason: "profile" });
    const refreshThermo = jest.fn().mockResolvedValue(coolReading);
    const { phases, result } = await episode({ attempt, refreshThermo });

    expect(result).toEqual({ pause_reason: "profile" });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(refreshThermo).not.toHaveBeenCalled();
    expect(phases).toEqual([]);
  });

  it("a stopped turn never enters cooling (stale turn, superseded send)", async () => {
    const attempt = jest.fn().mockResolvedValue(paused);
    const { phases, result } = await episode({ attempt, isStopped: () => true });

    expect(result).toBe(paused);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(phases).toEqual([]);
  });

  it("aborting mid-wait ends the episode without refresh or retry", async () => {
    const controller = new AbortController();
    const attempt = jest.fn().mockResolvedValue(paused);
    const refreshThermo = jest.fn().mockResolvedValue(coolReading);
    const { phases, result } = await episode({
      attempt,
      refreshThermo,
      signal: controller.signal,
      isStopped: () => controller.signal.aborted,
      wait: async () => {
        controller.abort();
      },
    });

    expect(result).toBe(paused);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(refreshThermo).not.toHaveBeenCalled();
    expect(phases).toEqual(["start", "wait", "end"]);
  });

  it("the default wait resolves early when the signal aborts (no armed timer left)", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);
    const startedAt = Date.now();
    const { phases } = await episode({
      attempt: async () => paused,
      isStopped: () => controller.signal.aborted,
      signal: controller.signal,
      pollIntervalMs: 5_000,
      // Explicit undefined selects the module's own cancellable wait.
      wait: undefined,
    });

    // Well under the 5 s poll: the abort cleared the timer and resolved it.
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(phases).toEqual(["start", "wait", "end"]);
  });

  it("gives up at the wall-clock bound and returns the still-paused result", async () => {
    let t = 0;
    const now = () => {
      t += 600_001; // one step past GOVERNOR_COOLING_MAX_MS per call
      return t;
    };
    const attempt = jest.fn().mockResolvedValue(paused);
    const { phases, result } = await episode({ attempt, now });

    expect(result).toBe(paused);
    expect(attempt).toHaveBeenCalledTimes(2); // first attempt + one retry
    expect(phases).toEqual(["start", "wait", "resume", "end"]);
  });

  it("a throwing thermo refresh is not a turn failure: the next cycle still resumes", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest
      .fn()
      .mockRejectedValueOnce(new Error("native thermo handle gone"))
      .mockResolvedValueOnce(coolReading);
    const { phases, result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(["start", "wait", "resume", "end"]);
  });

  it("the resume gate is the engine's warn line, in tenths", () => {
    expect(GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C).toBe(400);
  });
});
