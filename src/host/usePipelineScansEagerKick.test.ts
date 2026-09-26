/**
 * Hook-level tests for the eager kick's bench delay: usePipelineScans rendered
 * with react-test-renderer, the engine/storage modules mocked and the
 * scheduler (eagerKickDelay) plus the one-shot claim REAL. Scenarios: the
 * delay-0 synchronous kick, unmount during the wait, a flip to the
 * remote/computer mode during the wait, and an early send during the wait.
 */
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("../engine/ModelRegistry", () => ({
  MODEL_REGISTRY: [{ id: "local-a", name: "Local A" }],
  getDefaultModel: () => ({ id: "local-a", name: "Local A" }),
}));
jest.mock("../engine/ModelDownloader", () => ({
  isModelBundleDownloaded: jest.fn(async () => true),
}));
jest.mock("../engine/ModelDownloader.orphanMigration", () => ({
  detectOrphansAtBoot: jest.fn(async () => undefined),
}));
jest.mock("../engine/loadMarker", () => ({
  pickStartModel: jest.fn(() => "local-a"),
  readLastGoodModelId: jest.fn(async () => null),
  readLoadMarker: jest.fn(async () => false),
}));
jest.mock("../engine/engineBackend", () => ({
  disposeEngine: jest.fn(async () => true),
  getActiveModelId: jest.fn(() => null),
  isEngineReady: jest.fn(() => false),
  isRemoteEngineBackend: jest.fn(() => false),
  recoverLocalBackend: jest.fn(async () => undefined),
  setEngineBackendMode: jest.fn(async () => undefined),
}));
jest.mock("../documents/docOpGate", () => ({
  isDeleteActive: jest.fn(() => false),
}));
jest.mock("../engine/remote/remoteSettings", () => ({
  hydrateRemoteBrainSettings: jest.fn(async () => ({ hydrationOk: false })),
  isHydrationCurrent: jest.fn(() => false),
}));
jest.mock("../engine/remote/remoteComputerModel", () => ({
  REMOTE_COMPUTER_MODEL: { id: "remote", name: "Remote" },
  REMOTE_COMPUTER_MODEL_ID: "remote",
}));
jest.mock("../voice/WhisperService", () => ({
  isWhisperModelDownloaded: jest.fn(async () => false),
  releaseWhisper: jest.fn(async () => undefined),
}));
jest.mock("../voice/TtsService", () => ({
  isTtsEnabled: jest.fn(async () => true),
  setTtsEnabled: jest.fn(async () => undefined),
}));
jest.mock("../engine/EmbeddingService", () => ({
  getEmbeddingModelStatus: jest.fn(async () => "missing"),
  releaseEmbedder: jest.fn(async () => undefined),
}));
jest.mock("../engine/llamaContextGate", () => ({
  markChatReleased: jest.fn(),
  runNativeOp: jest.fn(async (fn: () => unknown) => fn()),
}));
jest.mock("./engineLoad", () => ({ loadMarkerStore: {} }));
jest.mock("./remoteHostBoot", () => ({
  planRemoteHostBoot: jest.fn(() => ({
    kind: "local",
    restoreModelId: "local-a",
    decision: { reason: "no-snapshot" },
    persistRemoteDemotion: false,
  })),
  pickHostBootModel: jest.fn(async () => "local-a"),
}));
jest.mock("./remoteBootFallback", () => ({
  recoverLocalAfterRemoteBootFailure: jest.fn(),
}));
jest.mock("../bench/eagerDelay", () => ({
  getBenchEagerDelayMs: jest.fn(async () => 0),
}));

import { getBenchEagerDelayMs } from "../bench/eagerDelay";
import {
  getActiveModelId,
  isEngineReady,
  isRemoteEngineBackend,
} from "../engine/engineBackend";
import type { ModelInfo } from "../engine/ModelRegistry";
import { cancelPendingEagerKick } from "./eagerKickDelay";
import { usePipelineScans } from "./usePipelineScans";
import type { ModelPipelineState } from "./hostPipelineState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCAL_MODEL = { id: "local-a", name: "Local A" } as unknown as ModelInfo;
type Ensure = (model: ModelInfo) => Promise<boolean>;

// claimEagerKick is one-shot per process (module state in ttftFlags), so each
// harness takes a fresh generation to keep tests independent.
let generationSeq = 0;

// One harness per test: fresh refs, the remoteActive ref driven by the prop.
function makeHarness(ensure: Ensure) {
  const refs = {
    modelIndexRef: { current: 0 },
    loadFallbackTargetRef: { current: null as string | null },
    embedderDownloadedRef: { current: false },
    engineGenerationRef: { current: ++generationSeq },
    chatGateGenRef: { current: null as number | null },
    ensureEngineForModelRef: { current: ensure },
    remoteActiveRef: { current: false },
  };
  const setters = {
    setModelIndex: jest.fn(),
    setModelState: jest.fn((_state: ModelPipelineState) => undefined),
    setModelError: jest.fn(),
    setModelErrorKind: jest.fn(),
    setModelErrorDetail: jest.fn(),
    setRemoteActive: jest.fn(),
  };
  function Probe({ remote }: { remote: boolean }) {
    refs.remoteActiveRef.current = remote;
    usePipelineScans({
      t: (key: string) => key,
      currentModel: LOCAL_MODEL,
      remoteActive: remote,
      refs,
      setters,
    });
    return null;
  }
  return { Probe, refs };
}

async function renderProbe(Probe: (props: { remote: boolean }) => null, remote = false) {
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(createElement(Probe, { remote }));
  });
  // Flush the boot effect chain (hydrate → plan → prefsReady → disk probe).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

function logLines(tag: string): string[] {
  return (console.log as jest.Mock).mock.calls
    .filter(([first]) => first === tag)
    .map(([, payload]) => payload as string);
}

function skipReasons(): string[] {
  return logLines("KALSA_EAGER_SKIP").map((p) => JSON.parse(p).reason);
}

beforeEach(() => {
  jest.clearAllMocks();
  (getBenchEagerDelayMs as jest.Mock).mockResolvedValue(0);
  (isRemoteEngineBackend as jest.Mock).mockReturnValue(false);
  (isEngineReady as jest.Mock).mockReturnValue(false);
  (getActiveModelId as jest.Mock).mockReturnValue(null);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  cancelPendingEagerKick("test_reset");
});

describe("eager kick at bench delay 0 (default path)", () => {
  test("kicks through the synchronous order — claim, log, ensure — and never schedules a wait", async () => {
    const ensure = jest.fn(async () => true);
    const { Probe } = makeHarness(ensure);
    const root = await renderProbe(Probe);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(LOCAL_MODEL);
    expect(logLines("engine.eagerInit")).toHaveLength(1);
    // Default-path log output is unchanged: no measurement lines at delay 0.
    expect(logLines("KALSA_EAGER")).toEqual([]);
    expect(logLines("KALSA_EAGER_SKIP")).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    act(() => {
      root.unmount();
    });
  });
});

describe("eager kick with a bench delay armed", () => {
  test("unmount during the wait cancels it: no load, host_teardown skip line", async () => {
    jest.useFakeTimers();
    (getBenchEagerDelayMs as jest.Mock).mockResolvedValue(8000);
    const ensure = jest.fn(async () => true);
    const { Probe } = makeHarness(ensure);
    const root = await renderProbe(Probe);
    expect(ensure).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    act(() => {
      root.unmount();
    });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60000);
    expect(ensure).not.toHaveBeenCalled();
    expect(skipReasons()).toContain("host_teardown");
  });

  test("a flip to the remote/computer mode during the wait never loads the local model", async () => {
    jest.useFakeTimers();
    (getBenchEagerDelayMs as jest.Mock).mockResolvedValue(8000);
    const ensure = jest.fn(async (_model: ModelInfo) => true);
    const { Probe } = makeHarness(ensure);
    const root = await renderProbe(Probe);
    expect(jest.getTimerCount()).toBe(1);
    // The user accepts the computer mode: backend and host flag flip.
    (isRemoteEngineBackend as jest.Mock).mockReturnValue(true);
    await act(async () => {
      root.update(createElement(Probe, { remote: true }));
    });
    jest.advanceTimersByTime(60000);
    const localLoads = ensure.mock.calls.filter(([m]) => m?.id === "local-a");
    expect(localLoads).toEqual([]);
    expect(skipReasons()).toContain("host_teardown");
  });

  test("a send during the wait loads immediately, and the wait ends as already_loaded", async () => {
    jest.useFakeTimers();
    (getBenchEagerDelayMs as jest.Mock).mockResolvedValue(8000);
    const ensure = jest.fn(async () => true);
    const { Probe, refs } = makeHarness(ensure);
    const root = await renderProbe(Probe);
    // The send path drives the same dispatch the composer uses.
    await act(async () => {
      await refs.ensureEngineForModelRef.current(LOCAL_MODEL);
    });
    expect(ensure).toHaveBeenCalledTimes(1);
    // The send's load completed: the engine now holds the model.
    (isEngineReady as jest.Mock).mockReturnValue(true);
    (getActiveModelId as jest.Mock).mockReturnValue("local-a");
    jest.advanceTimersByTime(8000);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(skipReasons()).toContain("already_loaded");
    const [payload] = logLines("KALSA_EAGER");
    expect(payload).toBeUndefined();
    act(() => {
      root.unmount();
    });
  });

  test("with no send and no switch, the wait fires and loads exactly once", async () => {
    jest.useFakeTimers();
    (getBenchEagerDelayMs as jest.Mock).mockResolvedValue(8000);
    const ensure = jest.fn(async () => true);
    const { Probe } = makeHarness(ensure);
    const root = await renderProbe(Probe);
    jest.advanceTimersByTime(8000);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(LOCAL_MODEL);
    const [payload] = logLines("KALSA_EAGER");
    expect(JSON.parse(payload)).toMatchObject({
      modelId: "local-a",
      delay_ms: 8000,
    });
    act(() => {
      root.unmount();
    });
  });
});
