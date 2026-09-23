/**
 * Facade dispatch pin (step 2, item d): UI-facing stream/init calls must
 * reach the remote client when the backend is remote, with their options —
 * memoryFacts among them — passed through untouched.
 */
jest.mock("./LlamaService", () => ({
  chatKvIsHeld: jest.fn(),
  completeOnce: jest.fn(),
  discardChatKvForWindowSlide: jest.fn(),
  disposeEngine: jest.fn(),
  extractMemory: jest.fn(),
  getActiveEngineNCtx: jest.fn(),
  getActiveModelId: jest.fn(),
  getEngineLostModelId: jest.fn(),
  getLoadedAssembleBoundary: jest.fn(),
  initEngine: jest.fn(),
  invalidateConversationSessions: jest.fn(),
  invalidateEngineSession: jest.fn(),
  isEngineLostRecovery: jest.fn(),
  isEngineReady: jest.fn(),
  markKvNonReproducible: jest.fn(),
  nativeEngineWorkInFlight: jest.fn(),
  notifyStaticPrefixInputs: jest.fn(),
  probeAndReconcileEngine: jest.fn(),
  queueStaticPrefixPrewarm: jest.fn(),
  restoreEngineSession: jest.fn(),
  saveEngineSession: jest.fn(),
  streamAssistantTurn: jest.fn(),
  translateText: jest.fn(),
}));

jest.mock("./remote/RemoteEngine", () => ({
  disposeRemoteEngine: jest.fn(),
  initRemoteEngine: jest.fn(),
  isRemoteEngineReady: jest.fn(() => true),
  isSupersededRemoteOp: jest.fn(() => false),
  remoteCompleteOnce: jest.fn(),
  remoteExtractMemory: jest.fn(),
  remoteInvalidateConversationSessions: jest.fn(),
  remoteInvalidateEngineSession: jest.fn(),
  remoteNativeWorkInFlight: jest.fn(() => false),
  remoteRestoreEngineSession: jest.fn(),
  remoteSaveEngineSession: jest.fn(),
  remoteTranslateText: jest.fn(),
  streamRemoteAssistantTurn: jest.fn(),
  testRemoteConnection: jest.fn(),
}));

jest.mock("./remote/remoteSettings", () => {
  let mode: "local" | "remote" = "local";
  return {
    ENGINE_BACKEND_KEY: "kalsa.engine.backend",
    beginBackendSwitch: jest.fn(),
    endBackendSwitch: jest.fn(),
    getEngineBackendMode: jest.fn(() => mode),
    getRemoteBrainUrl: jest.fn(() => ""),
    getRemoteContextSize: jest.fn(() => 4096),
    getRemoteServerModelId: jest.fn(() => ""),
    hydrateRemoteBrainSettings: jest.fn(),
    isHydrationCurrent: jest.fn(() => true),
    isRemoteEngineBackend: jest.fn(() => mode === "remote"),
    recoverLocalBackend: jest.fn(async () => {
      mode = "local";
    }),
    setEngineBackendMode: jest.fn(async (next: "local" | "remote") => {
      mode = next;
    }),
    setRemoteServerModelId: jest.fn(),
  };
});

import {
  initEngine,
  setEngineBackendMode,
  streamAssistantTurn,
} from "./engineBackend";

const llama = jest.requireMock("./LlamaService") as Record<string, jest.Mock>;
const remote = jest.requireMock("./remote/RemoteEngine") as Record<string, jest.Mock>;

beforeEach(async () => {
  jest.clearAllMocks();
  await setEngineBackendMode("local");
});

const callbacks = {
  onDelta: () => undefined,
  onDone: () => undefined,
  onError: () => undefined,
};

it("streams through the local engine when the backend is local", async () => {
  const messages = [{ role: "user" as const, content: "hi" }];
  const options = { locale: "en" as const };
  await streamAssistantTurn(messages, callbacks, undefined, options);
  expect(llama.streamAssistantTurn).toHaveBeenCalledWith(
    messages,
    callbacks,
    undefined,
    options,
  );
  expect(remote.streamRemoteAssistantTurn).not.toHaveBeenCalled();
});

it("streams through the remote client when the backend is remote, memoryFacts intact", async () => {
  await setEngineBackendMode("remote");
  const messages = [{ role: "user" as const, content: "hi" }];
  const memoryFacts = [
    { id: "f1", text: "The cat is named Nino", createdAt: 1_700_000_000_000 },
  ];
  const options = { locale: "en" as const, memoryFacts };
  await streamAssistantTurn(messages, callbacks, undefined, options);
  expect(llama.streamAssistantTurn).not.toHaveBeenCalled();
  expect(remote.streamRemoteAssistantTurn).toHaveBeenCalledTimes(1);
  const [gotMessages, gotCallbacks, gotSignal, gotOptions] =
    remote.streamRemoteAssistantTurn.mock.calls[0];
  expect(gotMessages).toBe(messages);
  expect(gotCallbacks).toBe(callbacks);
  expect(gotSignal).toBeUndefined();
  // The facade strips only `backend`; the rest (memoryFacts) must survive —
  // this is the real dispatch path, not the prompt unit test.
  expect(gotOptions.memoryFacts).toBe(memoryFacts);
});

it("routes initEngine by backend mode", async () => {
  await initEngine("/path/local.gguf", "qwen4b", { locale: "en" });
  expect(llama.initEngine).toHaveBeenCalledWith("/path/local.gguf", "qwen4b", {
    locale: "en",
  });
  await setEngineBackendMode("remote");
  await initEngine("", "kalsa-remote-mac", { locale: "en", backend: "remote" });
  expect(remote.initRemoteEngine).toHaveBeenCalledWith("", "kalsa-remote-mac", {
    locale: "en",
  });
});
