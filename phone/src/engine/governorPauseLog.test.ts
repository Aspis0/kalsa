/**
 * The pause evidence lines, pinned where they are built: payload shape
 * (numbers and closed-set literals only, one line per event) and the
 * utility refusal decision that decides whether the site line fires at all.
 * The episode cardinality test closes the loop the wiring guard cannot see:
 * one enter and one exit pair per cooling episode, driven through the real
 * loop with a fake clock and a spy listener.
 */
import {
  governorPauseLogLine,
  thermalCoolingLogLine,
  utilityGovernorPause,
} from "./governorPauseLog";
import { resumeWhileCooling } from "./thermalResume";

let log: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => log.mockRestore());

describe("utilityGovernorPause — the decision utilities branch on", () => {
  it.each(["thermal", "profile", "reload", "unexplained"] as const)(
    "a %s pause → true and exactly one {site, reason} line",
    (reason) => {
      expect(utilityGovernorPause({ pause_reason: reason }, "translate")).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
      const [line] = log.mock.calls[0] as [string];
      expect(line.startsWith("KALSA_GOVERNOR_PAUSE ")).toBe(true);
      expect(JSON.parse(line.slice("KALSA_GOVERNOR_PAUSE ".length))).toEqual({
        site: "translate",
        reason,
      });
    },
  );

  it("an unpaused or unknown result → false and no log", () => {
    expect(utilityGovernorPause({ text: "answer" }, "extractMemory")).toBe(false);
    expect(utilityGovernorPause({ pause_reason: "nonsense" }, "completeOnce")).toBe(false);
    expect(utilityGovernorPause(null, "translate")).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("the line builders — payload, one line per call", () => {
  const coolingDetail = (
    over: Partial<{ elapsedMs: number; battTempTenthsC: number | null; generationMs: number; endReason: "stopped" }> = {},
  ) => ({
    elapsedMs: 0,
    battTempTenthsC: null,
    generationMs: 0,
    ...over,
  });

  it("the turn-site pause line is exactly {turnId, round, reason}, single-line", () => {
    const line = governorPauseLogLine({ turnId: "7", round: 2, reason: "unexplained" });
    expect(line).not.toContain("\n");
    expect(line.startsWith("KALSA_GOVERNOR_PAUSE ")).toBe(true);
    expect(JSON.parse(line.slice("KALSA_GOVERNOR_PAUSE ".length))).toEqual({
      turnId: "7",
      round: 2,
      reason: "unexplained",
    });
  });

  it("an enter line carries waits and reading but never an outcome", () => {
    const line = thermalCoolingLogLine({
      turnId: "3",
      round: 0,
      phase: "enter",
      detail: coolingDetail({ elapsedMs: 0, battTempTenthsC: null }),
    });
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("KALSA_THERMAL_COOLING ".length))).toEqual({
      turnId: "3",
      round: 0,
      phase: "enter",
      waitedMs: 0,
      generationMs: 0,
      batt_temp_tenths_c: null,
    });
  });

  it("an exit line adds the outcome and the final numbers", () => {
    const line = thermalCoolingLogLine({
      turnId: "3",
      round: 1,
      phase: "exit",
      detail: coolingDetail({
        elapsedMs: 10_000,
        battTempTenthsC: 415,
        generationMs: 6_000,
        endReason: "stopped",
      }),
    });
    expect(JSON.parse(line.slice("KALSA_THERMAL_COOLING ".length))).toEqual({
      turnId: "3",
      round: 1,
      phase: "exit",
      waitedMs: 10_000,
      generationMs: 6_000,
      batt_temp_tenths_c: 415,
      outcome: "stopped",
    });
  });
});

describe("episode cardinality — one enter and one exit pair per episode", () => {
  it("a multi-cycle episode drives exactly one start and one end to its listener", async () => {
    let clock = 0;
    const onCooling = jest.fn();
    await resumeWhileCooling<{ pause_reason?: string }>({
      attempt: async () => ({ pause_reason: "thermal" }),
      // Stays above the resume gate, so the episode cycles to the bound.
      refreshThermo: async () => ({ batt_temp_tenths_c: 415 }),
      onCooling,
      isStopped: () => false,
      now: () => clock,
      wait: async () => {
        clock += 300_000;
      },
    });

    const phases = onCooling.mock.calls.map((call: unknown[]) => call[0]);
    expect(phases.filter((phase) => phase === "start")).toHaveLength(1);
    expect(phases.filter((phase) => phase === "end")).toHaveLength(1);
    expect(phases[phases.length - 1]).toBe("end");
    expect(onCooling.mock.calls[onCooling.mock.calls.length - 1][1]).toMatchObject({
      endReason: "timeout",
    });
  });
});
