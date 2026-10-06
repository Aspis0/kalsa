import {
  bindIrohBackgroundStop,
  IROH_BACKGROUND_STOP_DELAY_MS,
  notifyIrohTunnelClosed,
  type IrohBackgroundAppState,
} from "./irohBackgroundStop";

let unbind: (() => void) | null = null;

function bind(app: IrohBackgroundAppState, platform: string, stop: () => Promise<boolean>): void {
  unbind = bindIrohBackgroundStop(app, platform, stop);
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

describe("Android iroh background stop", () => {
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
    const secondUnbind = bindIrohBackgroundStop(second.source, "android", stopBridge);

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
    const iosUnbind = bindIrohBackgroundStop(app.source, "ios", stopBridge);
    app.change("background");
    jest.advanceTimersByTime(IROH_BACKGROUND_STOP_DELAY_MS);
    expect(stopBridge).not.toHaveBeenCalled();
    expect(app.remove).not.toHaveBeenCalled();
    iosUnbind();
  });
});
