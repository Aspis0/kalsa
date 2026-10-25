/**
 * The one dispose discipline every resident-context release shares: wait out a
 * load another owner holds, refuse when the caller's reason is gone or a newer
 * owner holds the engine, dispose through the native-op FIFO, then ALWAYS reset
 * the boot-history hash and release the chat slot. The reset used to belong to
 * the poisoned release alone; pinning it on the shared dispose is what stops
 * the memory-warning release from disposing a poisoned context and leaving a
 * stale session hash for the background guard to clear (iosBackgroundPlan.ts).
 */
jest.mock("../engine/LlamaService", () => ({
  disposeEngine: jest.fn(async () => undefined),
  isContextPoisoned: jest.fn(() => true),
  isEngineHung: jest.fn(() => false),
  isEngineReady: jest.fn(() => true),
}));

jest.mock("../engine/llamaContextGate", () => ({
  getChatGeneration: jest.fn(() => 7),
  markChatReleased: jest.fn(),
  runNativeOp: jest.fn(async (fn: () => Promise<unknown>) => fn()),
}));

jest.mock("../engine/sessionPersistence", () => ({
  resetBootHistoryHash: jest.fn(),
}));

jest.mock("./loadSettle", () => ({
  waitForInFlightChatLoad: jest.fn(async () => "none"),
}));

import {
  disposeEngine,
  isContextPoisoned,
  isEngineHung,
  isEngineReady,
} from "../engine/LlamaService";
import {
  getChatGeneration,
  markChatReleased,
  runNativeOp,
} from "../engine/llamaContextGate";
import { resetBootHistoryHash } from "../engine/sessionPersistence";
import { releasePoisonedContext } from "./poisonedContext";
import { releaseResidentContext } from "./residentContextRelease";

const dispose = disposeEngine as jest.Mock;
const hung = isEngineHung as jest.Mock;
const ready = isEngineReady as jest.Mock;
const poisoned = isContextPoisoned as jest.Mock;
const generation = getChatGeneration as jest.Mock;
const released = markChatReleased as jest.Mock;
const nativeOp = runNativeOp as jest.Mock;
const resetHash = resetBootHistoryHash as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  dispose.mockResolvedValue(undefined);
  hung.mockReturnValue(false);
  ready.mockReturnValue(true);
  poisoned.mockReturnValue(true);
  generation.mockReturnValue(7);
  nativeOp.mockImplementation(async (fn: () => Promise<unknown>) => fn());
});

describe("releaseResidentContext", () => {
  it("disposes, resets the boot hash and releases the chat slot", async () => {
    await expect(releaseResidentContext(() => true)).resolves.toBe("released");

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(resetHash).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledWith(7);
  });

  it("refuses when the caller's reason is gone, disposing nothing", async () => {
    await expect(releaseResidentContext(() => false)).resolves.toBe("absent");

    expect(dispose).not.toHaveBeenCalled();
    expect(resetHash).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
  });

  it("refuses when a newer load owns the gate while we waited", async () => {
    generation.mockReturnValueOnce(7).mockReturnValue(8);

    await expect(releaseResidentContext(() => true)).resolves.toBe("absent");

    expect(dispose).not.toHaveBeenCalled();
    expect(resetHash).not.toHaveBeenCalled();
  });

  it("refuses when no context is loaded", async () => {
    ready.mockReturnValue(false);

    await expect(releaseResidentContext(() => true)).resolves.toBe("absent");

    expect(dispose).not.toHaveBeenCalled();
    expect(resetHash).not.toHaveBeenCalled();
  });

  it("withholds and keeps the hash when the dispose throws", async () => {
    dispose.mockRejectedValue(new Error("native dispose failed"));

    await expect(releaseResidentContext(() => true)).resolves.toBe("withheld");

    expect(resetHash).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
  });

  it("withholds when the safety timeout leaves the engine hung", async () => {
    hung.mockReturnValue(true);

    await expect(releaseResidentContext(() => true)).resolves.toBe("withheld");

    expect(resetHash).not.toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
  });
});

describe("releasePoisonedContext", () => {
  it("goes through the same dispose, so its context resets the boot hash too", async () => {
    await expect(releasePoisonedContext()).resolves.toBe("released");

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(resetHash).toHaveBeenCalledTimes(1);
  });

  it("refuses a context the mark does not cover", async () => {
    poisoned.mockReturnValue(false);

    await expect(releasePoisonedContext()).resolves.toBe("absent");

    expect(dispose).not.toHaveBeenCalled();
    expect(resetHash).not.toHaveBeenCalled();
  });
});
