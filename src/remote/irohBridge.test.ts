/**
 * The native dial's race: `openTunnel` has no deadline of its own (only
 * read/write do), so the caller's signal is the only clock. Settle-once:
 * abort rejects at once, a handle landed after the abort is shut down,
 * and no signal keeps the dial exactly as it was.
 */

jest.mock("../../modules/kalsa-iroh/src/index", () => ({
  isNativeModulePresent: jest.fn(() => true),
  startBridge: jest.fn(async () => undefined),
  openTunnel: jest.fn(),
  tunnelWrite: jest.fn(),
  tunnelRead: jest.fn(async () => ""),
  tunnelShutdown: jest.fn(),
}));

import { openTunnel, tunnelShutdown } from "../../modules/kalsa-iroh/src/index";
import { openIrohTunnel } from "./irohBridge";

const NODE = "ab".repeat(32);
const openTunnelMock = openTunnel as jest.MockedFunction<typeof openTunnel>;
const shutdownMock = tunnelShutdown as jest.MockedFunction<typeof tunnelShutdown>;

const drain = () => new Promise((resolve) => setImmediate(resolve));

describe("the iroh dial race", () => {
  beforeEach(() => {
    openTunnelMock.mockReset();
    shutdownMock.mockReset();
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
