import { createBackgroundGrace } from "./backgroundGrace";

describe("createBackgroundGrace", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function makeGrace() {
    return createBackgroundGrace({
      graceMs: 1000,
      setTimeout,
      clearTimeout,
    });
  }

  test("runs after the grace period", () => {
    const grace = makeGrace();
    const run = jest.fn();
    grace.onBackground(run);

    jest.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(grace.isPending()).toBe(false);
  });

  test("foreground within the grace cancels the run", () => {
    const grace = makeGrace();
    const run = jest.fn();
    grace.onBackground(run);

    expect(grace.onForeground()).toBe(true);
    jest.runAllTimers();
    expect(run).not.toHaveBeenCalled();
    expect(grace.isPending()).toBe(false);
  });

  test("a second background does not double-schedule", () => {
    const grace = makeGrace();
    const first = jest.fn();
    const second = jest.fn();
    grace.onBackground(first);
    grace.onBackground(second);

    jest.runAllTimers();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test("cancel stops a pending run", () => {
    const grace = makeGrace();
    const run = jest.fn();
    grace.onBackground(run);

    expect(grace.cancel()).toBe(true);
    expect(grace.cancel()).toBe(false);
    jest.runAllTimers();
    expect(run).not.toHaveBeenCalled();
  });

  test("supports an injected handle type", () => {
    type FakeHandle = { token: string };
    let pendingRun: (() => void) | null = null;
    const handle: FakeHandle = { token: "native-1" };
    const grace = createBackgroundGrace<FakeHandle>({
      graceMs: 1000,
      setTimeout: (run) => {
        pendingRun = run;
        return handle;
      },
      clearTimeout: (value) => {
        expect(value).toBe(handle);
        pendingRun = null;
      },
    });
    const run = jest.fn();

    grace.onBackground(run);
    expect(pendingRun).not.toBeNull();
    pendingRun!();

    expect(run).toHaveBeenCalledTimes(1);
    expect(grace.isPending()).toBe(false);
  });
});
