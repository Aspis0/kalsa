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
});
