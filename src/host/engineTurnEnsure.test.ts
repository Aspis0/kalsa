/**
 * The send's ensure outcome (deepseek F2/F3): a refused ensure is not one
 * verdict. While ANOTHER owner's load holds the gate (`chat_loading`) the
 * load is succeeding — the send waits it out, retries once, and only then
 * classifies; a stop during the wait ends the turn without a verdict; and
 * an OS-thermal refusal of the load takes the thermal copy, never
 * `chat.modelLoadFailed`. The load-failed copy is left for the case it
 * names: a genuinely failing load of a downloaded bundle.
 */
jest.mock("../engine/ModelDownloader", () => ({
  isModelBundleDownloaded: jest.fn(async () => false),
}));
jest.mock("../engine/engineBackend", () => ({
  completeOnce: jest.fn(),
  getActiveEngineNCtx: jest.fn(() => 0),
  getActiveModelId: jest.fn(() => null),
  invalidateEngineSession: jest.fn(),
  isRemoteEngineBackend: jest.fn(() => false),
}));
jest.mock("../engine/LlamaService", () => ({
  chatKvLastSaveTokens: jest.fn(),
  chatKvNPast: jest.fn(),
  getAttemptedAssembleStart: jest.fn(),
  buildSystemPrompt: jest.fn(),
  resolvedStaticPrefixTokens: jest.fn(),
}));
jest.mock("../screens/PersonasScreen", () => ({ builtinCopyFromT: jest.fn() }));
jest.mock("./engineTurnStream", () => ({ streamEngineTurn: jest.fn() }));

import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import {
  __resetForTests as resetGate,
  getState,
  markChatReleased,
  tryAcquireChat,
} from "../engine/llamaContextGate";
import { handleSendStream } from "./engineTurn";
import { buildTurnDeps, type HostDepsInput } from "./hostDeps";
import type { EngineTurnCallbacks } from "./engineTurnDeps";

const LOCAL_MODEL = MODEL_REGISTRY[0];

function turnHarness() {
  const thermalHardGateRef = { current: false };
  const ensureMock = jest.fn(async (_model: typeof LOCAL_MODEL) => false);
  const setStreaming = jest.fn();
  const input = {
    t: ((key: string) => key) as HostDepsInput["t"],
    locale: "en",
    thermalHardGateRef,
    thermalHardGated: false,
    streamInFlightRef: { current: false },
    nativeTurnStartAtRef: { current: 0 },
    conversationsRef: { current: { activeId: "active" } },
    memoryExtractRef: { current: null },
    memoryExtractCancelRef: { current: null },
    memoryEnabledRef: { current: false },
    memoryFactsRef: { current: [] },
    injectedFactsRef: { current: [] },
    setMemoryFacts: jest.fn(),
    refreshMemoryFacts: jest.fn(async () => undefined),
    lastUserRawRef: { current: "" },
    activeDocumentAttachmentRef: { current: null },
    onMiniappRef: { current: jest.fn() },
    toolhelpRef: { current: false },
    contextModeRef: { current: "off" },
    compactionEnabledRef: { current: false },
    documentLibraryRef: { current: { docs: [] } },
    embedderDownloadedRef: { current: false },
    personasStateRef: { current: {} },
    activePersonaIdRef: { current: "" },
    webToolsEnabled: false,
    deviceToolsEnabled: false,
    calendarToolsEnabled: false,
    webToolsEnabledRef: { current: false },
    deviceToolsEnabledRef: { current: false },
    calendarToolsEnabledRef: { current: false },
    currentModel: LOCAL_MODEL,
    ensureEngineForModelRef: { current: ensureMock },
    remoteErrorRef: { current: null },
    chatEngineCtxRef: { current: 0 },
    recordDecodeSample: jest.fn(),
    agentOptions: {},
    agentOptionsRef: { current: {} },
    setStreaming,
  } as unknown as HostDepsInput;
  const deps = { ...buildTurnDeps(input), isTurnOwner: () => true };
  const callbacks: EngineTurnCallbacks = {
    onDelta: jest.fn(),
    onFailed: jest.fn(),
    onFailedReason: jest.fn(),
  };
  return { thermalHardGateRef, ensureMock, setStreaming, deps, callbacks };
}

describe("the send's ensure outcome", () => {
  beforeEach(() => {
    resetGate();
    jest.mocked(isModelBundleDownloaded).mockResolvedValue(false);
  });
  afterEach(() => resetGate());

  test("a send never reports load failure while another load is mid-flight: wait, retry, then classify", async () => {
    const chatGen = tryAcquireChat();
    expect(chatGen).not.toBeNull();
    expect(getState()).toBe("chat_loading");
    // The other owner's load finishes while this send waits.
    setTimeout(() => markChatReleased(chatGen!), 60);

    const { ensureMock, callbacks, deps } = turnHarness();
    // The retry fails for real (the other load is over) — the copy must name
    // THAT failure, and only after the settle.
    jest.mocked(isModelBundleDownloaded).mockResolvedValueOnce(true);
    const gateStateAtCall: string[] = [];
    ensureMock.mockImplementation(async () => {
      gateStateAtCall.push(getState());
      return false;
    });

    await handleSendStream(deps, "hello", callbacks, new AbortController().signal);

    expect(ensureMock).toHaveBeenCalledTimes(2);
    // The retry ran only after the other load settled — while chat_loading
    // the gate refuses everything, which is exactly the false-failure case.
    expect(gateStateAtCall[1]).not.toBe("chat_loading");
    expect(callbacks.onFailed).toHaveBeenCalledWith("chat.modelLoadFailed");
  });

  test("stopping during the wait ends the turn with no verdict at all", async () => {
    const chatGen = tryAcquireChat();
    expect(chatGen).not.toBeNull();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    const { ensureMock, callbacks, setStreaming, deps } = turnHarness();

    await handleSendStream(deps, "hello", callbacks, controller.signal);

    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(callbacks.onFailed).not.toHaveBeenCalled();
    // finish() released the turn — nothing stays wedged on the stopped send.
    expect(setStreaming).toHaveBeenCalledWith(false);
  });

  test("an OS-thermal refusal of the load takes the thermal copy, never load-failed", async () => {
    const { thermalHardGateRef, ensureMock, callbacks, deps } = turnHarness();
    // The gate flips mid-ensure — the case the pre-send backstop cannot see.
    ensureMock.mockImplementation(async () => {
      thermalHardGateRef.current = true;
      return false;
    });
    // Downloaded IS true here: thermal must outrank the load-failed branch.
    jest.mocked(isModelBundleDownloaded).mockResolvedValueOnce(true);

    await handleSendStream(deps, "hello", callbacks, new AbortController().signal);

    expect(callbacks.onFailed).toHaveBeenCalledWith("chat.thermalHardGateBody");
    expect(callbacks.onFailed).not.toHaveBeenCalledWith("chat.modelLoadFailed");
  });
});
