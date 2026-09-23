jest.mock("../engine/ModelDownloader", () => ({
  isModelBundleDownloaded: jest.fn(async () => false),
}));
jest.mock("../engine/engineBackend", () => ({
  completeOnce: jest.fn(),
  getActiveEngineNCtx: jest.fn(() => 0),
  getActiveModelId: jest.fn(() => null),
  invalidateEngineSession: jest.fn(),
  isRemoteEngineBackend: jest.fn(() => true),
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

import { REMOTE_COMPUTER_MODEL, REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { buildTurnDeps, type HostDepsInput } from "./hostDeps";
import { handleSendStream } from "./engineTurn";
import { createModelEnsureDispatch } from "./modelEnsureDispatch";
import { readFileSync } from "fs";
import { join } from "path";

const MODEL_HOST = readFileSync(join(__dirname, "useModelHost.ts"), "utf8");

describe("remote send ensure uses the real host dependency builder", () => {
  test("a remote turn reaches remote ensure and never the local loader", async () => {
    const localLoader = jest.fn(async () => true);
    const remoteEnsure = jest.fn(async () => false);
    const ensureRef = {
      current: createModelEnsureDispatch(
        REMOTE_COMPUTER_MODEL_ID,
        remoteEnsure,
        localLoader,
      ),
    };
    const input = {
      t: ((key: string) => key) as HostDepsInput["t"],
      locale: "en",
      thermalHardGateRef: { current: false },
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
      currentModel: REMOTE_COMPUTER_MODEL,
      ensureEngineForModelRef: ensureRef,
      remoteErrorRef: { current: null },
      chatEngineCtxRef: { current: 0 },
      recordDecodeSample: jest.fn(),
      agentOptions: {},
      agentOptionsRef: { current: {} },
      setStreaming: jest.fn(),
    } as unknown as HostDepsInput;
    const deps = buildTurnDeps(input);
    const callbacks = { onDelta: jest.fn(), onFailed: jest.fn() };

    await handleSendStream(deps, "hello", callbacks, new AbortController().signal);

    expect(remoteEnsure).toHaveBeenCalledTimes(1);
    expect(localLoader).not.toHaveBeenCalled();
    expect(MODEL_HOST).toContain("createModelEnsureDispatch(");
  });
});
