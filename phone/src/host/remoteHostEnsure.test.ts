jest.mock("../engine/engineBackend", () => ({
  getActiveModelId: jest.fn(() => null),
  initEngine: jest.fn(async () => ({ effectiveNCtx: 4096 })),
  isEngineReady: jest.fn(() => false),
}));

import { getActiveModelId, initEngine, isEngineReady } from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { makeT } from "../i18n";
import { ensureRemoteHostModel } from "./remoteHostEnsure";
import type { ModelPipelineState } from "./hostPipelineState";

function ports() {
  const states: string[] = [];
  const modelStateRef: { current: ModelPipelineState } = { current: "checking" };
  const chatEngineCtxRef = { current: 0 };
  const remoteErrorRef = { current: "stale error" as string | null };
  const setModelState = jest.fn((state: "checking" | "missing" | "downloading" | "loading" | "ready" | "error") => {
    states.push(state);
  });
  return {
    input: {
      locale: "en" as const,
      t: makeT("en"),
      generationRef: { current: 1 },
      modelStateRef,
      setModelState,
      setModelError: jest.fn(),
      setModelErrorKind: jest.fn(),
      setModelErrorDetail: jest.fn(),
      setChatEngineCtx: jest.fn(),
      chatEngineCtxRef,
      remoteErrorRef,
    },
    states,
    modelStateRef,
    chatEngineCtxRef,
    remoteErrorRef,
    setModelState,
  };
}

describe("the host's remote ensure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isEngineReady as jest.Mock).mockReturnValue(false);
    (getActiveModelId as jest.Mock).mockReturnValue(null);
    (initEngine as jest.Mock).mockResolvedValue({ effectiveNCtx: 4096 });
  });

  test("an already-ready remote engine returns ready without a loading flash or re-init", async () => {
    (isEngineReady as jest.Mock).mockReturnValue(true);
    (getActiveModelId as jest.Mock).mockReturnValue(REMOTE_COMPUTER_MODEL_ID);
    const p = ports();

    await expect(ensureRemoteHostModel(p.input)).resolves.toBe(true);

    expect(p.states).toEqual(["ready"]);
    expect(initEngine).not.toHaveBeenCalled();
    expect(p.remoteErrorRef.current).toBeNull();
  });

  test("a cold ensure initializes the remote id through the facade and publishes its context", async () => {
    const p = ports();

    await expect(ensureRemoteHostModel(p.input)).resolves.toBe(true);

    expect(initEngine).toHaveBeenCalledWith("", REMOTE_COMPUTER_MODEL_ID, {
      locale: "en",
      backend: "remote",
    });
    expect(p.states).toEqual(["loading", "ready"]);
    expect(p.modelStateRef.current).toBe("ready");
    expect(p.chatEngineCtxRef.current).toBe(4096);
    expect(p.input.setChatEngineCtx).toHaveBeenCalledWith(4096);
  });

  test("a superseded ensure does not publish a stale ready result", async () => {
    let resolveInit: ((value: { effectiveNCtx: number }) => void) | undefined;
    (initEngine as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { resolveInit = resolve; }),
    );
    const p = ports();
    const pending = ensureRemoteHostModel(p.input);
    p.input.generationRef.current += 1;
    resolveInit?.({ effectiveNCtx: 8192 });

    await expect(pending).resolves.toBe(false);
    expect(p.states).toEqual(["loading"]);
    expect(p.input.setChatEngineCtx).not.toHaveBeenCalled();
  });
});
