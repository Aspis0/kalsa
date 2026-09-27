/**
 * The platform pause gate on its edges: SEVERE opens an episode (even with
 * a cool battery — the engine's battery policy never fires in that case),
 * MODERATE keeps a paused episode paused and only LIGHT closes it, a 2 at
 * the start of a round never pauses at all, and a missing/unknown/throwing
 * read never blocks (fail-open, the hard gate's contract). The loop
 * integration proves the refusal enters the SAME cooling machinery an
 * engine thermal pause uses, and that with an unknown platform read the
 * battery rule still holds the retry.
 */
import { getCurrentPlatformThermalState } from "../../modules/kalsa-thermal/src";
import { createPlatformPauseGate, readPlatformThermalStatus } from "./platformPauseGate";
import { resumeWhileCooling, type CoolingPhase } from "./thermalResume";

jest.mock("../../modules/kalsa-thermal/src", () => ({
  getCurrentPlatformThermalState: jest.fn(),
}));

const readState = getCurrentPlatformThermalState as jest.MockedFunction<
  typeof getCurrentPlatformThermalState
>;

const android = (androidStatus: number) => ({
  platform: "android" as const,
  supported: true,
  androidStatus,
});

describe("readPlatformThermalStatus", () => {
  it("returns the Android status", async () => {
    readState.mockResolvedValueOnce(android(3));
    expect(await readPlatformThermalStatus()).toBe(3);
    readState.mockResolvedValueOnce(android(2));
    expect(await readPlatformThermalStatus()).toBe(2);
  });

  it("returns null for an unsupported module, iOS, or a thrown call (fail-open)", async () => {
    readState.mockResolvedValueOnce({ platform: "android", supported: false });
    expect(await readPlatformThermalStatus()).toBeNull();
    readState.mockResolvedValueOnce({
      platform: "ios",
      supported: true,
      iosState: "serious",
    });
    expect(await readPlatformThermalStatus()).toBeNull();
    readState.mockRejectedValueOnce(new Error("no native"));
    expect(await readPlatformThermalStatus()).toBeNull();
  });
});

describe("createPlatformPauseGate", () => {
  const scripted = (...statuses: (number | null)[]) => {
    let i = 0;
    return createPlatformPauseGate(async () => {
      const at = i;
      i += 1;
      const status = statuses[Math.min(at, statuses.length - 1)];
      if (status === undefined || status === null) return null;
      return status;
    });
  };

  it("SEVERE pauses the first attempt", async () => {
    expect(await scripted(3).shouldPauseNow()).toBe(true);
  });

  it("status 2 at the start of a round does not pause", async () => {
    expect(await scripted(2).shouldPauseNow()).toBe(false);
  });

  it("a paused episode resumes only at LIGHT: 3 pauses, 2 holds, 1 closes", async () => {
    const gate = scripted(3, 2, 1);
    expect(await gate.shouldPauseNow()).toBe(true);
    expect(await gate.shouldPauseNow()).toBe(true);
    expect(await gate.shouldPauseNow()).toBe(false);
  });

  it("an unknown read never blocks, even mid-episode (fail-open)", async () => {
    const gate = scripted(3, null);
    expect(await gate.shouldPauseNow()).toBe(true);
    expect(await gate.shouldPauseNow()).toBe(false);
  });

  it("a throwing reader never blocks (fail-open)", async () => {
    const gate = createPlatformPauseGate(async () => {
      throw new Error("thermal api gone");
    });
    expect(await gate.shouldPauseNow()).toBe(false);
  });
});

type Res = { pause_reason?: string; text?: string };

describe("with the cooling loop", () => {
  it("SEVERE with a cool battery pauses through the cooling machinery and resumes at LIGHT", async () => {
    const statuses = [3, 3, 1];
    const gate = createPlatformPauseGate(async () => statuses.shift() ?? 1);
    const phases: CoolingPhase[] = [];
    let refused = 0;
    let ran = 0;

    const result = await resumeWhileCooling<Res>({
      attempt: async () => {
        if (await gate.shouldPauseNow()) {
          refused += 1;
          return { pause_reason: "thermal" };
        }
        ran += 1;
        return { text: "ok" };
      },
      // The battery is cool the whole time: the engine's own policy would
      // never pause here — only the platform gate opens the episode.
      refreshThermo: async () => ({ batt_temp_tenths_c: 355 }),
      onCooling: (phase) => {
        phases.push(phase);
      },
      isStopped: () => false,
      wait: async () => undefined,
    });

    expect(result).toEqual({ text: "ok" });
    expect(refused).toBe(2);
    expect(ran).toBe(1);
    expect(phases).toEqual(["start", "wait", "resume", "wait", "resume", "end"]);
  });

  it("an unknown platform read never blocks, and the battery rule still holds the retry", async () => {
    const gate = createPlatformPauseGate(async () => null);
    let enginePaused = true;
    let attempts = 0;

    const result = await resumeWhileCooling<Res>({
      attempt: async () => {
        attempts += 1;
        if (await gate.shouldPauseNow()) return { pause_reason: "thermal" };
        if (enginePaused) {
          enginePaused = false;
          return { pause_reason: "thermal" };
        }
        return { text: "ok" };
      },
      // 412 is over the engine's warn line: the retry must wait for 399
      // even though the platform read says nothing.
      refreshThermo: jest
        .fn()
        .mockResolvedValueOnce({ batt_temp_tenths_c: 412 })
        .mockResolvedValueOnce({ batt_temp_tenths_c: 399 }),
      onCooling: () => undefined,
      isStopped: () => false,
      wait: async () => undefined,
    });

    expect(result).toEqual({ text: "ok" });
    expect(attempts).toBe(2);
  });
});
