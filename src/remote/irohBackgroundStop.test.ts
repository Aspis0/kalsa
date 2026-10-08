import {
  bindIrohBackgroundStop,
  IROH_BACKGROUND_STOP_DELAY_MS,
  IROH_IDLE_STOP_DELAY_MS,
  notifyIrohDial,
  notifyIrohTunnelClosed,
  type IrohBackgroundAppState,
} from "./irohBackgroundStop";
import type { BackgroundTimer } from "../platform/backgroundTimer";

let unbind: (() => void) | null = null;

function fakeBackgroundTimer(): BackgroundTimer {
  return {
    setTimeout: (run, delayMs) => ({
      kind: "js",
      value: globalThis.setTimeout(run, delayMs),
    }),
    clearTimeout: (handle) => {
      if (handle.kind === "js") globalThis.clearTimeout(handle.value);
    },
    source: "js",
  };
}

function bind(
  app: IrohBackgroundAppState,
  platform: string,
  stop: () => Promise<boolean>,
  timer: BackgroundTimer = fakeBackgroundTimer(),
): void {
  unbind = bindIrohBackgroundStop(app, platform, stop, timer);
}

function appStateSource(): {
  source: IrohBackgroundAppState;
  change: (state: string) => void;
  remove: jest.Mock;
} {
  let handler: (state: string) => void = () => undefined;
  const remove = jest.fn();
  return {
    source: {
      addEventListener: (_type, nextHandler) => {
        handler = nextHandler;
        return { remove };
      },
    },
    change: (state) => handler(state),
    remove,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  unbind?.();
  unbind = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Android iroh background stop", () => {
  test("stops after the background delay", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("background");

    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS - 1);
    expect(stopBridge).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });

  test("schedules the deadline through the injected background timer", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    const timer = fakeBackgroundTimer();
    const schedule = jest.spyOn(timer, "setTimeout");
    bind(app.source, "android", stopBridge, timer);
    app.change("background");

    expect(schedule).toHaveBeenCalledWith(expect.any(Function), IROH_BACKGROUND_STOP_DELAY_MS);
  });

  test("foreground cancels the pending stop", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("background");
    jest.advanceTimersByTime(10_000);
    app.change("active");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();
  });

  test("open tunnels keep the bridge and the final close retries", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    bind(app.source, "android", stopBridge);
    app.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    notifyIrohTunnelClosed();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(2);
  });

  test("every close retries only after background deadline", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn().mockResolvedValue(false);
    bind(app.source, "android", stopBridge);

    notifyIrohTunnelClosed();
    app.change("background");
    notifyIrohTunnelClosed();
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    notifyIrohTunnelClosed();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(2);
  });

  test("unbind removes the close listener", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn().mockResolvedValue(false);
    bind(app.source, "android", stopBridge);
    app.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    unbind?.();
    unbind = null;
    notifyIrohTunnelClosed();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });

  test("a second Android bind is ignored", () => {
    const first = appStateSource();
    const second = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(first.source, "android", stopBridge);
    const secondUnbind = bindIrohBackgroundStop(
      second.source,
      "android",
      stopBridge,
      fakeBackgroundTimer(),
    );

    second.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();
    secondUnbind();
    first.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    expect(stopBridge).toHaveBeenCalledTimes(1);
    expect(first.remove).not.toHaveBeenCalled();
  });

  test("iOS does not subscribe or stop", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    const iosUnbind = bindIrohBackgroundStop(app.source, "ios", stopBridge, fakeBackgroundTimer());
    app.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();
    expect(app.remove).not.toHaveBeenCalled();
    iosUnbind();
  });
});

describe("Android iroh foreground idle stop", () => {
  test("stops 120 s after a dial with no further dial", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();

    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    const log = jest.spyOn(console, "log");
    const decisions = log.mock.calls
      .filter((call) => call[0] === "KALSA_ROAD")
      .map((call) => String(call[1]));
    expect(decisions.some((line) => line.includes('"stage":"idle_stop"'))).toBe(true);
  });

  test("a dial at 100 s pushes the idle deadline out", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();

    jest.advanceTimersByTime(100_000);
    expect(stopBridge).not.toHaveBeenCalled();
    notifyIrohDial();
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });

  test("a tunnel close in foreground re-arms the full idle window", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    notifyIrohTunnelClosed();
    expect(stopBridge).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(stopBridge).toHaveBeenCalledTimes(2);
  });

  test("a dial while the idle stop is pending keeps its own window", async () => {
    const app = appStateSource();
    let resolveStop!: (stopped: boolean) => void;
    const stopBridge = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStop = resolve;
        }),
    );
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();

    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS);
    expect(stopBridge).toHaveBeenCalledTimes(1);

    notifyIrohDial();
    resolveStop(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(stopBridge).toHaveBeenCalledTimes(2);
  });

  test("a second idle cycle after a successful stop stops again", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();

    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    notifyIrohDial();
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(stopBridge).toHaveBeenCalledTimes(2);
  });

  test("background cancels the idle timer and takes over", async () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("active");
    notifyIrohDial();
    app.change("background");

    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(stopBridge).toHaveBeenCalledTimes(1);

    // Well past the idle deadline: the cancelled idle timer must stay silent.
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS);
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });

  test("no stop before the first dial", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);
    app.change("active");

    jest.advanceTimersByTime(10 * IROH_IDLE_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();
  });

  test("returning active re-arms only when a dial happened", () => {
    const app = appStateSource();
    const stopBridge = jest.fn(async () => true);
    bind(app.source, "android", stopBridge);

    app.change("background");
    app.change("active");
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();

    notifyIrohDial();
    app.change("background");
    app.change("active");
    jest.advanceTimersByTime(IROH_IDLE_STOP_DELAY_MS - 1);
    expect(stopBridge).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });
});
