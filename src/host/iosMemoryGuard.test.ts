/**
 * The memory guard's behaviour, driven through a real mount: the subscription
 * registers on iOS, a warning releases the resident contexts through their own
 * dispose paths, a warning that finds work (or a send) in flight leaves the
 * release OWED and the settle notification runs it when that work ends, and
 * unmounting both removes the listener and forgets the debt. The settle bus is
 * the real one; only the engine modules it reports about are mocked.
 */
const mockWarningHandlers: Array<() => void> = [];
const mockRemoveListener = jest.fn();

jest.mock("react-native", () => ({
  AppState: {
    addEventListener: (event: string, handler: () => void) => {
      if (event === "memoryWarning") mockWarningHandlers.push(handler);
      return { remove: mockRemoveListener };
    },
  },
  Platform: { OS: "ios" },
}));

jest.mock("../engine/LlamaService", () => ({
  isEngineReady: jest.fn(() => false),
  nativeEngineWorkInFlight: jest.fn(() => false),
}));

jest.mock("../engine/EmbeddingService", () => ({
  isEmbedderActive: jest.fn(() => false),
  releaseEmbedder: jest.fn(async () => undefined),
}));

jest.mock("../engine/llamaContextGate", () => ({
  getState: jest.fn(() => "idle"),
}));

jest.mock("../engine/engineBackend", () => ({
  isRemoteEngineBackend: jest.fn(() => false),
}));

jest.mock("./residentContextRelease", () => ({
  releaseResidentContext: jest.fn(async () => "released"),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { isEmbedderActive, releaseEmbedder } from "../engine/EmbeddingService";
import { isEngineReady, nativeEngineWorkInFlight } from "../engine/LlamaService";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { getState as getLlamaContextGateState } from "../engine/llamaContextGate";
import { notifyNativeWorkSettled } from "../engine/nativeWorkSettle";
import { sendClaimRef, sendingInFlightRef } from "../engine/regenState";
import { useIosMemoryGuard } from "./iosMemoryGuard";
import { releaseResidentContext } from "./residentContextRelease";

const residentChat = isEngineReady as jest.Mock;
const nativeWork = nativeEngineWorkInFlight as jest.Mock;
const embedderActive = isEmbedderActive as jest.Mock;
const releaseEmbedding = releaseEmbedder as jest.Mock;
const remote = isRemoteEngineBackend as jest.Mock;
const chatGate = getLlamaContextGateState as jest.Mock;
const releaseChat = releaseResidentContext as jest.Mock;

let logLines: string[];
let consoleInfo: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockWarningHandlers.length = 0;
  sendClaimRef.current = false;
  sendingInFlightRef.current = false;
  residentChat.mockReturnValue(false);
  nativeWork.mockReturnValue(false);
  embedderActive.mockReturnValue(false);
  releaseEmbedding.mockResolvedValue(undefined);
  remote.mockReturnValue(false);
  chatGate.mockReturnValue("idle");
  releaseChat.mockResolvedValue("released");
  logLines = [];
  consoleInfo = jest
    .spyOn(console, "info")
    .mockImplementation((tag: unknown, payload: unknown) => {
      if (tag === "KALSA_IOS_MEM") logLines.push(String(payload));
    });
});

afterEach(() => {
  consoleInfo.mockRestore();
});

function Guard(): null {
  useIosMemoryGuard();
  return null;
}

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Guard));
  });
  return renderer;
}

/** Deliver one iOS memory warning, flushing whatever it started. */
async function warn(): Promise<void> {
  await act(async () => {
    for (const handler of [...mockWarningHandlers]) handler();
  });
}

/** One settle, with the guard's queued reaction flushed. `duringNotify` runs
 *  after the notification and before the flush — the microtask window the
 *  engine turn's own bookkeeping clears its refs in. */
async function settle(duringNotify?: () => void): Promise<void> {
  await act(async () => {
    notifyNativeWorkSettled();
    duringNotify?.();
    // The guard's reaction is queued as a macrotask, never run inline.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useIosMemoryGuard", () => {
  it("subscribes once and releases a resident idle chat engine", async () => {
    residentChat.mockReturnValue(true);
    await mount();
    expect(mockWarningHandlers).toHaveLength(1);

    await warn();

    expect(releaseChat).toHaveBeenCalledTimes(1);
    expect(releaseEmbedding).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"release"}']);
  });

  it("releases an idle embedder the warning found resident on its own", async () => {
    embedderActive.mockReturnValue(true);
    await mount();

    await warn();

    expect(releaseEmbedding).toHaveBeenCalledTimes(1);
    expect(releaseChat).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"release"}']);
  });

  it("never releases the embedder a warning deferred: the work ends first", async () => {
    embedderActive.mockReturnValue(true);
    nativeWork.mockReturnValue(true);
    await mount();

    await warn();
    expect(releaseEmbedding).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"deferred"}']);

    nativeWork.mockReturnValue(false);
    await settle();
    expect(releaseEmbedding).toHaveBeenCalledTimes(1);
  });

  it("keeps the release owed while a send owns the engine — the warning's own plan decides", async () => {
    residentChat.mockReturnValue(true);
    nativeWork.mockReturnValue(true);
    await mount();
    await warn();
    expect(releaseChat).not.toHaveBeenCalled();

    // An unrelated settle (a prewarm or an embed) lands after the claim and the
    // ensure, before the completion registers: the send still owns the turn.
    nativeWork.mockReturnValue(false);
    sendClaimRef.current = true;
    sendingInFlightRef.current = true;
    await settle();
    expect(releaseChat).not.toHaveBeenCalled();

    // The turn's finish notifies while its refs are still set; `sendHost` clears
    // them in the send's microtask continuation, before the queued check runs.
    await settle(() => {
      sendClaimRef.current = false;
      sendingInFlightRef.current = false;
    });
    expect(releaseChat).toHaveBeenCalledTimes(1);
  });

  it("keeps a deferred chat release owed until the native work really ends", async () => {
    residentChat.mockReturnValue(true);
    nativeWork.mockReturnValue(true);
    await mount();

    await warn();
    expect(releaseChat).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"deferred"}']);

    // A settle that still finds work changes nothing; the next one releases.
    await settle();
    expect(releaseChat).not.toHaveBeenCalled();

    nativeWork.mockReturnValue(false);
    await settle();
    expect(releaseChat).toHaveBeenCalledTimes(1);
  });

  it("records a skip when there is nothing local to release", async () => {
    await mount();

    await warn();

    expect(releaseChat).not.toHaveBeenCalled();
    expect(releaseEmbedding).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"skip","reason":"no-engine"}']);
  });

  it("keeps Remote (PC Brain) mode a no-op", async () => {
    remote.mockReturnValue(true);
    residentChat.mockReturnValue(true);
    await mount();

    await warn();

    expect(releaseChat).not.toHaveBeenCalled();
    expect(logLines).toEqual(['{"op":"skip","reason":"remote"}']);
  });

  it("removes the listener and forgets the debt on unmount", async () => {
    residentChat.mockReturnValue(true);
    nativeWork.mockReturnValue(true);
    const renderer = await mount();
    await warn();
    expect(logLines).toEqual(['{"op":"deferred"}']);

    await act(async () => {
      renderer.unmount();
    });
    expect(mockRemoveListener).toHaveBeenCalledTimes(1);

    nativeWork.mockReturnValue(false);
    await settle();
    await warn();
    expect(releaseChat).not.toHaveBeenCalled();
  });
});
