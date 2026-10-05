/**
 * The advisory thermal sampler must not read thermal_zone0 / MemAvailable
 * every 30 s with the screen off. This pins the pause on
 * `background`/`inactive` and the immediate re-sample on `active` — the
 * policy `useBatteryEta` already uses.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// Save what we replace: a test that mutates the environment must put it back.
const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const realError = console.error;
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("react-test-renderer is deprecated")) {
      return;
    }
    realError(...args);
  });
});

jest.mock("react-native", () => {
  const listeners = new Set<(state: string) => void>();
  return {
    Platform: { OS: "android" },
    AppState: {
      addEventListener: (_type: string, listener: (state: string) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      __fire: (state: string) => {
        for (const listener of [...listeners]) listener(state);
      },
    },
  };
});

// An unreadable zone: the sample falls through to the memory proxy, which is
// the one step every sample runs.
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(async () => ""),
}));

jest.mock("../../modules/kalsa-thermal/src", () => ({
  getCurrentPlatformThermalState: jest.fn(async () => ({ platform: "android", supported: false })),
}));

jest.mock("../engine/nativeCallTimeout", () => ({
  withNativeCallTimeout: (promise: Promise<unknown>) => promise,
}));

jest.mock("../engine/monitor", () => ({
  getAvailableMemoryBytesUncached: jest.fn(async () => 4_000_000_000),
}));

import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { useThermalMonitor } from "./useThermalMonitor";

const appState = (
  jest.requireMock("react-native") as { AppState: { __fire: (s: string) => void } }
).AppState;
const reads = getAvailableMemoryBytesUncached as jest.MockedFunction<
  typeof getAvailableMemoryBytesUncached
>;

const INTERVAL_MS = 30_000;

function Probe() {
  useThermalMonitor({ intervalMs: INTERVAL_MS });
  return null;
}

describe("useThermalMonitor samples only while foregrounded", () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    jest.useFakeTimers();
    reads.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      renderer.unmount();
    });
    jest.useRealTimers();
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      previousActEnvironment;
    jest.restoreAllMocks();
  });

  async function mount() {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
  }

  const tick = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  test("background and inactive pause the interval; active resumes it at once", async () => {
    await mount();
    expect(reads).toHaveBeenCalledTimes(1);
    await tick(INTERVAL_MS);
    expect(reads).toHaveBeenCalledTimes(2);

    await act(async () => appState.__fire("background"));
    await tick(INTERVAL_MS * 4);
    expect(reads).toHaveBeenCalledTimes(2);

    await act(async () => appState.__fire("inactive"));
    await tick(INTERVAL_MS * 4);
    expect(reads).toHaveBeenCalledTimes(2);

    await act(async () => appState.__fire("active"));
    expect(reads).toHaveBeenCalledTimes(3);
    await tick(INTERVAL_MS);
    expect(reads).toHaveBeenCalledTimes(4);
  });
});
