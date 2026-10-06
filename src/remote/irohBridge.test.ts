/**
 * The native dial's race: `openTunnel` has no deadline of its own (only
 * read/write do), so the caller's signal is the only clock. Settle-once:
 * abort rejects at once, a handle landed after the abort is shut down,
 * and no signal keeps the dial exactly as it was.
 */

jest.mock("../../modules/kalsa-iroh/src/index", () => ({
  isNativeModulePresent: jest.fn(() => true),
  startBridge: jest.fn(async () => undefined),
  stopBridge: jest.fn(async () => true),
  openTunnel: jest.fn(),
  tunnelWrite: jest.fn(),
  tunnelRead: jest.fn(async () => ""),
  tunnelShutdown: jest.fn(),
}));

import { openTunnel, startBridge, stopBridge, tunnelShutdown } from "../../modules/kalsa-iroh/src/index";
import { openIrohTunnel, stopIrohBridge } from "./irohBridge";

const NODE = "ab".repeat(32);
const openTunnelMock = openTunnel as jest.MockedFunction<typeof openTunnel>;
const shutdownMock = tunnelShutdown as jest.MockedFunction<typeof tunnelShutdown>;
const startMock = startBridge as jest.MockedFunction<typeof startBridge>;
const stopMock = stopBridge as jest.MockedFunction<typeof stopBridge>;

const drain = () => new Promise((resolve) => setImmediate(resolve));

describe("the iroh dial race", () => {
  beforeEach(() => {
    openTunnelMock.mockReset();
    shutdownMock.mockReset();
    startMock.mockReset().mockResolvedValue(undefined);
    stopMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("stop waits for a pending start and the next dial starts again", async () => {
    let resolveStart!: () => void;
    startMock.mockImplementation(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    openTunnelMock.mockResolvedValueOnce(6).mockResolvedValueOnce(7);

    const firstDial = openIrohTunnel(NODE, "door");
    const stop = stopIrohBridge();
    await Promise.resolve();
    expect(stopMock).not.toHaveBeenCalled();

    resolveStart();
    const tunnel = await firstDial;
    expect(await stop).toBe(true);
    expect(stopMock).toHaveBeenCalledTimes(1);
    await tunnel.shutdown();

    startMock.mockResolvedValue(undefined);
    const restarted = await openIrohTunnel(NODE, "door");
    expect(startMock).toHaveBeenCalledTimes(2);
    await restarted.shutdown();
  });

  test("a dial arriving during stop resumes after stop and restarts lazily", async () => {
    let resolveStop!: (stopped: boolean) => void;
    stopMock.mockImplementation(() => new Promise<boolean>((resolve) => { resolveStop = resolve; }));
    openTunnelMock.mockResolvedValue(31);
    const stop = stopIrohBridge();
    const dial = openIrohTunnel(NODE, "door");
    await Promise.resolve();
    expect(startMock).toHaveBeenCalledTimes(0);

    resolveStop(true);
    expect(await stop).toBe(true);
    const tunnel = await dial;
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(openTunnelMock).toHaveBeenCalledWith(NODE, "door");
    await tunnel.shutdown();
  });

  test("a rejected stop does not fail a waiting dial", async () => {
    stopMock.mockRejectedValue(new Error("private stop detail"));
    openTunnelMock.mockResolvedValue(32);
    const stop = stopIrohBridge();
    const dial = openIrohTunnel(NODE, "door");

    await expect(stop).rejects.toThrow("private stop detail");
    const tunnel = await dial;
    expect(openTunnelMock).toHaveBeenCalledWith(NODE, "door");
    await tunnel.shutdown();
  });

  test("a dial stops waiting after the native stop wait limit", async () => {
    jest.useFakeTimers();
    let resolveStop!: (stopped: boolean) => void;
    stopMock.mockImplementation(() => new Promise<boolean>((resolve) => { resolveStop = resolve; }));
    openTunnelMock.mockResolvedValue(33);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const stop = stopIrohBridge();
    const dial = openIrohTunnel(NODE, "door");

    jest.advanceTimersByTime(3_000);
    await Promise.resolve();
    await Promise.resolve();
    const tunnel = await dial;
    const diagnostics = log.mock.calls.filter((call) => call[0] === "KALSA_ROAD");
    expect(diagnostics.some((call) => call[1]?.includes('"reason":"stop_timeout"'))).toBe(true);

    resolveStop(false);
    expect(await stop).toBe(false);
    await tunnel.shutdown();
    jest.useRealTimers();
  });

  test("abort during bridge start rejects without waiting for the start", async () => {
    stopMock.mockResolvedValue(true);
    await stopIrohBridge();
    let resolveStart!: () => void;
    startMock.mockImplementation(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    const controller = new AbortController();
    const pending = openIrohTunnel(NODE, "door", controller.signal);
    const asserted = expect(pending).rejects.toThrow("dial aborted");
    await Promise.resolve();

    controller.abort();
    await asserted;
    expect(openTunnelMock).not.toHaveBeenCalled();
    resolveStart();
  });

  test("an abort during the native dial rejects at once and the late tunnel is shut down", async () => {
    let resolveDial!: (id: number) => void;
    let dialStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      dialStarted = resolve;
    });
    openTunnelMock.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveDial = resolve;
          dialStarted();
        }),
    );
    const controller = new AbortController();

    const pending = openIrohTunnel(NODE, "door", controller.signal);
    const asserted = expect(pending).rejects.toThrow("dial aborted");
    // Only abort once the race is armed: the native dial is in flight.
    await started;
    controller.abort();
    await asserted;

    // The native side lands the handle after its caller gave up: it dies.
    resolveDial(7);
    await drain();
    expect(shutdownMock).toHaveBeenCalledWith(7);
  });

  test("a signal aborted before the dial never reaches the native side", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(openIrohTunnel(NODE, "door", controller.signal)).rejects.toThrow("dial aborted");
    expect(openTunnelMock).not.toHaveBeenCalled();
  });

  test("without a signal the dial settles natively and the tunnel shuts down once", async () => {
    openTunnelMock.mockResolvedValue(11);

    const tunnel = await openIrohTunnel(NODE, "door");
    await tunnel.shutdown();
    await tunnel.shutdown();

    expect(openTunnelMock).toHaveBeenCalledWith(NODE, "door");
    expect(shutdownMock).toHaveBeenCalledTimes(1);
    expect(shutdownMock).toHaveBeenCalledWith(11);
  });

  test.each(["desk", "door"] as const)("a successful %s dial emits exactly one timed line", async (lane) => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    openTunnelMock.mockResolvedValue(21);

    await openIrohTunnel(NODE, lane);

    const lines = log.mock.calls.filter((call) => call[0] === "KALSA_ROAD");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0][1] as string)).toEqual({
      road: "iroh",
      lane,
      stage: "dial",
      reason: "ok",
      ms: expect.any(Number),
      node8: NODE.slice(0, 8),
    });
    log.mockRestore();
  });

  test("a native dial rejection emits exactly one mapped line without its raw message", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    openTunnelMock.mockRejectedValue(
      Object.assign(new Error("private peer detail"), { code: "KALSA_IROH_DEADLINE" }),
    );

    await expect(openIrohTunnel(NODE, "desk")).rejects.toThrow("private peer detail");

    const lines = log.mock.calls.filter((call) => call[0] === "KALSA_ROAD");
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toContain('"reason":"deadline"');
    expect(lines[0][1]).not.toContain("private peer detail");
    log.mockRestore();
  });
});
