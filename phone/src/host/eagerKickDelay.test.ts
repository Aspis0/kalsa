/**
 * Unit tests for the eager kick's bench wait: fake timers, the real one-shot
 * claim (ttftFlags is not mocked), console.log spied. The hook-level
 * scenarios (unmount, remote flip, early send during the wait) live in
 * usePipelineScansEagerKick.test.ts.
 */
import { cancelPendingEagerKick, startEagerKick } from "./eagerKickDelay";
import { claimEagerKick } from "../engine/ttftFlags";

let idSeq = 0;

function waitArgs(overrides: Partial<Parameters<typeof startEagerKick>[0]> = {}) {
  return {
    modelId: `model-${++idSeq}`,
    generation: 1,
    delayMs: 5000,
    anchorMs: () => null,
    remoteActive: () => false,
    alreadyLoaded: () => false,
    ensure: jest.fn(),
    ...overrides,
  };
}

function lines(tag: string): string[] {
  return (console.log as jest.Mock).mock.calls
    .filter(([first]) => first === tag)
    .map(([, payload]) => payload as string);
}

function skipReasons(): string[] {
  return lines("KALSA_EAGER_SKIP").map((payload) => JSON.parse(payload).reason);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  cancelPendingEagerKick("test_reset");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("startEagerKick firing", () => {
  test("fires once after the full delay and logs KALSA_EAGER with modelId and generation", () => {
    const wait = waitArgs();
    startEagerKick(wait);
    jest.advanceTimersByTime(4999);
    expect(wait.ensure).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(wait.ensure).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60000);
    expect(wait.ensure).toHaveBeenCalledTimes(1);
    const [payload] = lines("KALSA_EAGER");
    expect(JSON.parse(payload)).toMatchObject({
      modelId: wait.modelId,
      generation: wait.generation,
      delay_ms: 5000,
    });
    expect(JSON.parse(payload).since_launch_ms).toEqual(expect.any(Number));
  });

  test("counts the delay from the anchor (first committed render), not from the schedule", () => {
    const wait = waitArgs({ anchorMs: () => Date.now() - 4000 });
    startEagerKick(wait);
    jest.advanceTimersByTime(999);
    expect(wait.ensure).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(wait.ensure).toHaveBeenCalledTimes(1);
  });
});

describe("startEagerKick fire-time veto", () => {
  test("remote backend active at fire time skips the load", () => {
    const wait = waitArgs({ remoteActive: () => true });
    startEagerKick(wait);
    jest.advanceTimersByTime(60000);
    expect(wait.ensure).not.toHaveBeenCalled();
    expect(skipReasons()).toContain("remote");
    expect(lines("KALSA_EAGER")).toEqual([]);
  });

  test("a load an early send already started skips the kick", () => {
    const wait = waitArgs({ alreadyLoaded: () => true });
    startEagerKick(wait);
    jest.advanceTimersByTime(60000);
    expect(wait.ensure).not.toHaveBeenCalled();
    expect(skipReasons()).toContain("already_loaded");
  });
});

describe("the one-shot claim", () => {
  test("a cancelled wait does not consume it", () => {
    const wait = waitArgs();
    startEagerKick(wait);
    cancelPendingEagerKick("host_teardown");
    expect(claimEagerKick(wait.modelId, wait.generation)).toBe(true);
  });

  test("a vetoed fire does not consume it; a real fire does", () => {
    const skipped = waitArgs({ alreadyLoaded: () => true });
    startEagerKick(skipped);
    jest.advanceTimersByTime(60000);
    expect(claimEagerKick(skipped.modelId, skipped.generation)).toBe(true);

    const fired = waitArgs();
    startEagerKick(fired);
    jest.advanceTimersByTime(60000);
    expect(claimEagerKick(fired.modelId, fired.generation)).toBe(false);
  });
});

describe("cancelPendingEagerKick", () => {
  test("cancels the wait, logs the skip reason, leaves no timer", () => {
    const wait = waitArgs();
    startEagerKick(wait);
    expect(jest.getTimerCount()).toBe(1);
    expect(cancelPendingEagerKick("host_teardown")).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60000);
    expect(wait.ensure).not.toHaveBeenCalled();
    expect(skipReasons()).toEqual(["host_teardown"]);
  });

  test("with nothing pending it is a silent no-op", () => {
    expect(cancelPendingEagerKick("host_teardown")).toBe(false);
    expect(lines("KALSA_EAGER_SKIP")).toEqual([]);
  });

  test("after the kick fired it is a no-op", () => {
    const wait = waitArgs({ delayMs: 1 });
    startEagerKick(wait);
    jest.advanceTimersByTime(1);
    expect(wait.ensure).toHaveBeenCalledTimes(1);
    expect(cancelPendingEagerKick("late")).toBe(false);
    expect(wait.ensure).toHaveBeenCalledTimes(1);
  });

  test("a second wait supersedes the pending one", () => {
    const first = waitArgs();
    const second = waitArgs();
    startEagerKick(first);
    startEagerKick(second);
    expect(skipReasons()).toEqual(["superseded"]);
    jest.advanceTimersByTime(60000);
    expect(first.ensure).not.toHaveBeenCalled();
    expect(second.ensure).toHaveBeenCalledTimes(1);
  });
});
