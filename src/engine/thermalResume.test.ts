/**
 * The pause→cool→resume state machine, proved on its edges: a resume
 * brackets the episode with the listener's phases and its end reason, a
 * still-hot reading stays cooling without an attempt (399 resumes, 400
 * waits), a stop landing inside the refresh never reaches the retry, the
 * shipped cap/poll numbers are pinned, non-thermal pauses and stopped turns
 * never enter cooling at all, an abort mid-wait ends the episode cleanly,
 * the wall-clock bound gives up returning the paused result, and no path —
 * including a throwing refresh — ever throws into the caller (this module has
 * no error channel: persisting anything is the caller's decision).
 */
import {
  GOVERNOR_COOLING_MAX_MS,
  GOVERNOR_COOLING_POLL_MS,
  GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C,
  governorPauseEnding,
  pauseReasonOf,
  resumeWhileCooling,
  type CoolingDetail,
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
  const details: CoolingDetail[] = [];
  const result = await resumeWhileCooling(
    base({
      ...over,
      onCooling: (phase, detail) => {
        phases.push(phase);
        details.push(detail);
      },
    }),
  );
  return { phases, details, result };
}

describe("pauseReasonOf — the binding's typed outcome, read structurally", () => {
  it.each(["thermal", "profile", "reload", "unexplained"] as const)(
    "accepts %s",
    (reason) => {
      expect(pauseReasonOf({ pause_reason: reason })).toBe(reason);
    },
  );

  it("never mistakes an unknown or absent reason for a pause", () => {
    expect(pauseReasonOf({ pause_reason: "overheat" })).toBeNull();
    expect(pauseReasonOf({ pause_reason: 3 })).toBeNull();
    expect(pauseReasonOf({})).toBeNull();
    expect(pauseReasonOf(null)).toBeNull();
    expect(pauseReasonOf("thermal")).toBeNull();
  });
});

describe("governorPauseEnding — a paused result never finalises as an empty reply", () => {
  it("thermal ends on the cooling give-up line", () => {
    expect(governorPauseEnding({ pause_reason: "thermal" })).toBe("coolingTimedOut");
  });

  it.each(["profile", "reload", "unexplained"] as const)(
    "%s ends on the generic service line — there is no resume path",
    (reason) => {
      expect(governorPauseEnding({ pause_reason: reason })).toBe("serviceUnreachable");
    },
  );

  it("a non-paused result ends nothing", () => {
    expect(governorPauseEnding({ text: "answer" })).toBeNull();
    expect(governorPauseEnding({ pause_reason: "something-new" })).toBeNull();
    expect(governorPauseEnding(null)).toBeNull();
  });
});

describe("resumeWhileCooling", () => {
  it("retries the same completion once the reading allows, bracketing the episode", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest.fn().mockResolvedValue(coolReading);
    const { phases, details, result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(refreshThermo).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["start", "wait", "resume", "end"]);
    expect(details.at(-1)?.endReason).toBe("resumed");
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
    const { phases, details, result } = await episode({
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
    expect(details.at(-1)?.endReason).toBe("stopped");
  });

  it("a stop landing inside the thermo refresh never reaches the retry (the last gate)", async () => {
    let stopped = false;
    const attempt = jest.fn().mockResolvedValue(paused);
    const refreshThermo = jest.fn().mockImplementation(async () => {
      stopped = true; // the turn ended while the reading was in flight
      return coolReading;
    });
    const { phases, details, result } = await episode({
      attempt,
      refreshThermo,
      isStopped: () => stopped,
    });

    expect(result).toBe(paused);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["start", "wait", "end"]);
    expect(details.at(-1)?.endReason).toBe("stopped");
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
    const { phases, details, result } = await episode({ attempt, now });

    expect(result).toBe(paused);
    expect(attempt).toHaveBeenCalledTimes(2); // first attempt + one retry
    expect(phases).toEqual(["start", "wait", "resume", "end"]);
    expect(details.at(-1)?.endReason).toBe("timeout");
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

  it("the shipped numbers: the 10-minute cap, and every wait polls at 10 s", async () => {
    expect(GOVERNOR_COOLING_MAX_MS).toBe(600_000);
    expect(GOVERNOR_COOLING_POLL_MS).toBe(10_000);
    const wait = jest.fn(async (_ms: number, _signal?: AbortSignal) => undefined);
    await episode({
      attempt: jest.fn().mockResolvedValueOnce(paused).mockResolvedValueOnce(ok),
      wait,
    });
    // The loop hands the default interval to the wait, not a hidden literal.
    expect(wait.mock.calls[0]?.[0]).toBe(GOVERNOR_COOLING_POLL_MS);
  });

  it("399 tenths is under the warn line: the retry runs", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest.fn().mockResolvedValue({ batt_temp_tenths_c: 399 });
    const { result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(refreshThermo).toHaveBeenCalledTimes(1);
  });

  it("exactly 400 tenths is AT the warn line: it waits instead of retrying", async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(ok);
    const refreshThermo = jest
      .fn()
      .mockResolvedValueOnce({ batt_temp_tenths_c: 400 })
      .mockResolvedValueOnce({ batt_temp_tenths_c: 399 });
    const { phases, result } = await episode({ attempt, refreshThermo });

    expect(result).toBe(ok);
    // The 400 reading waited: only the 399 reading attempted.
    expect(refreshThermo).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(["start", "wait", "wait", "resume", "end"]);
  });

  it("a retry that throws ends the episode as failed, with the error unchanged", async () => {
    const boom = new Error("completion threw");
    const phases: CoolingPhase[] = [];
    const details: CoolingDetail[] = [];
    const attempt = jest
      .fn()
      .mockResolvedValueOnce(paused)
      .mockRejectedValueOnce(boom);

    await expect(
      resumeWhileCooling(
        base({
          attempt,
          onCooling: (phase, detail) => {
            phases.push(phase);
            details.push(detail);
          },
        }),
      ),
    ).rejects.toBe(boom);

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(phases.at(-1)).toBe("end");
    expect(details.at(-1)?.endReason).toBe("failed");
  });

  it("waitedMs counts only waiting: the retry's generation is generationMs", async () => {
    let clock = 0;
    let calls = 0;
    const attempt = jest.fn(async () => {
      calls += 1;
      if (calls === 1) return paused;
      clock += 60_000; // generation time inside the retry
      return ok;
    });
    const { details, result } = await episode({
      attempt,
      now: () => clock,
      wait: async () => {
        clock += 100_000; // one wait cycle
      },
    });

    expect(result).toBe(ok);
    const end = details.at(-1);
    expect(end?.elapsedMs).toBe(100_000); // the wait — not the 160_000 wall
    expect(end?.generationMs).toBe(60_000);
    expect(end?.endReason).toBe("resumed");
  });

  it("the APPLIED budget is the shipped 10 minutes, not a multiple of it", async () => {
    let clock = 0;
    const attempt = jest.fn().mockResolvedValue(paused);
    const { details } = await episode({
      attempt,
      now: () => clock,
      wait: async () => {
        clock += 300_000;
      },
    });

    // The default maxCoolingMs: initial attempt + exactly two retries.
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(details.at(-1)?.endReason).toBe("timeout");
  });
});
