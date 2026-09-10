jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import { createBackgroundTimer } from "./backgroundTimer";

describe("createBackgroundTimer", () => {
  test("uses the native pair when present", () => {
    const handle = { id: 7, subscription: { remove: jest.fn() } };
    const schedule = jest.fn(() => handle);
    const cancel = jest.fn();
    const timer = createBackgroundTimer({ schedule, cancel });
    const run = jest.fn();

    const nativeHandle = timer.setTimeout(run, 45000);

    expect(nativeHandle.kind).toBe("native");
    expect(schedule).toHaveBeenCalledWith(run, 45000);
    expect(timer.source).toBe("native");
  });

  test("falls back to JS when the native pair is null", () => {
    jest.useFakeTimers();
    const timer = createBackgroundTimer(null);
    const run = jest.fn();

    const jsHandle = timer.setTimeout(run, 10);
    jest.advanceTimersByTime(10);

    expect(jsHandle.kind).toBe("js");
    expect(run).toHaveBeenCalledTimes(1);
    expect(timer.source).toBe("js");
    jest.useRealTimers();
  });

  test("routes cancellation to the matching scheduler", () => {
    jest.useFakeTimers();
    const nativeHandle = { id: 8, subscription: { remove: jest.fn() } };
    const cancel = jest.fn();
    const nativeTimer = createBackgroundTimer({
      schedule: jest.fn(() => nativeHandle),
      cancel,
    });
    const jsTimer = createBackgroundTimer(null);
    const native = nativeTimer.setTimeout(jest.fn(), 1);
    const js = jsTimer.setTimeout(jest.fn(), 1);

    nativeTimer.clearTimeout(native);
    jsTimer.clearTimeout(js);

    expect(cancel).toHaveBeenCalledWith(nativeHandle);
    expect(nativeHandle.subscription.remove).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
