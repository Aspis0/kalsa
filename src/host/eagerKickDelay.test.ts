/**
 * Unit tests for the eager-kick start path. InteractionManager is mocked,
 * timers are fake: the kick fires exactly once after gate + delay, the
 * default delay-0 path stays synchronous, and an explicit cancel (user send
 * / unmount) voids the wait.
 */

jest.mock("react-native", () => ({
  InteractionManager: {
    runAfterInteractions: jest.fn((task: () => void) => {
      task();
      return { cancel: jest.fn() };
    }),
  },
}));

import { InteractionManager } from "react-native";
import { cancelPendingEagerKick, startEagerKick } from "./eagerKickDelay";

const runAfterInteractions =
  InteractionManager.runAfterInteractions as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  runAfterInteractions.mockClear();
  // Default: the interaction gate is already settled.
  runAfterInteractions.mockImplementation((task: () => void) => {
    task();
    return { cancel: jest.fn() };
  });
  cancelPendingEagerKick();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function kickArgs(delayMs: number, alreadyLoaded: () => boolean = () => false) {
  return {
    modelId: "model-a",
    generation: 7,
    delayMs,
    alreadyLoaded,
    kick: jest.fn(),
  };
}

describe("startEagerKick with delay 0 (default path)", () => {
  test("kicks synchronously and logs the measurement line", () => {
    const args = kickArgs(0);
    startEagerKick(args);
    expect(args.kick).toHaveBeenCalledTimes(1);
    const kalsaLine = (console.log as jest.Mock).mock.calls.find(
      ([tag]) => tag === "KALSA_EAGER",
    );
    expect(JSON.parse(kalsaLine![1])).toMatchObject({ delay_ms: 0 });
  });

  test("does not consult alreadyLoaded — the default path is unchanged", () => {
    const args = kickArgs(0, () => true);
    startEagerKick(args);
    expect(args.kick).toHaveBeenCalledTimes(1);
    expect(runAfterInteractions).not.toHaveBeenCalled();
  });
});

describe("startEagerKick with a bench delay", () => {
  test("fires exactly once, after the full delay, logging at fire time", () => {
    const args = kickArgs(5000);
    startEagerKick(args);
    expect(args.kick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4999);
    expect(args.kick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(args.kick).toHaveBeenCalledTimes(1);
    const kalsaLine = (console.log as jest.Mock).mock.calls.find(
      ([tag]) => tag === "KALSA_EAGER",
    );
    expect(JSON.parse(kalsaLine![1])).toMatchObject({ delay_ms: 5000 });
    jest.advanceTimersByTime(60000);
    expect(args.kick).toHaveBeenCalledTimes(1);
  });

  test("the delay starts only once interactions settle", () => {
    runAfterInteractions.mockImplementation(() => ({ cancel: jest.fn() }));
    const args = kickArgs(1000);
    startEagerKick(args);
    jest.advanceTimersByTime(10000);
    expect(args.kick).not.toHaveBeenCalled();
    runAfterInteractions.mock.calls[0][0]();
    jest.advanceTimersByTime(999);
    expect(args.kick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(args.kick).toHaveBeenCalledTimes(1);
  });

  test("an early send that loaded the model skips the kick entirely", () => {
    const args = kickArgs(5000, () => true);
    startEagerKick(args);
    jest.advanceTimersByTime(60000);
    expect(args.kick).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith("KALSA_EAGER", expect.any(String));
  });
});

describe("cancelPendingEagerKick (early send / unmount)", () => {
  test("a cancel before the fire voids the wait", () => {
    const args = kickArgs(5000);
    startEagerKick(args);
    expect(cancelPendingEagerKick()).toBe(true);
    jest.advanceTimersByTime(60000);
    expect(args.kick).not.toHaveBeenCalled();
    expect(cancelPendingEagerKick()).toBe(false);
  });

  test("a cancel while interactions are pending voids the not-yet-armed timer", () => {
    runAfterInteractions.mockImplementation(() => ({ cancel: jest.fn() }));
    const args = kickArgs(1000);
    startEagerKick(args);
    expect(cancelPendingEagerKick()).toBe(true);
    // Even a gate callback that slips through after the cancel arms nothing.
    runAfterInteractions.mock.calls[0][0]();
    jest.advanceTimersByTime(60000);
    expect(args.kick).not.toHaveBeenCalled();
  });

  test("cancel after the kick fired is a no-op", () => {
    const args = kickArgs(1);
    startEagerKick(args);
    jest.advanceTimersByTime(1);
    expect(args.kick).toHaveBeenCalledTimes(1);
    expect(cancelPendingEagerKick()).toBe(false);
    expect(args.kick).toHaveBeenCalledTimes(1);
  });

  test("the fired kick's ensure re-entering the cancel cannot self-cancel", () => {
    const args = kickArgs(1);
    args.kick = jest.fn(() => {
      // The real kick calls ensureEngineForModel, which cancels the pending
      // wait; after firing it must already be detached.
      expect(cancelPendingEagerKick()).toBe(false);
    });
    startEagerKick(args);
    jest.advanceTimersByTime(1);
    expect(args.kick).toHaveBeenCalledTimes(1);
  });
});
