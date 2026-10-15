/**
 * What an Android activity recreation does to the computer choice — the S23
 * test, reproduced. The engine keeps the choice on disk (`kalsa.engine.backend`,
 * written by the picker), the pairing keeps the door, and nothing else does: a
 * JS re-run starts every module from scratch, so the host has to read both back
 * before it can say where it answers.
 *
 * Storage is the device's: a backend key, a remote model id, a pairing in the
 * keystore, and NO manual address — a paired phone reaches its computer through
 * the pairing record and never writes one. The settings, door and boot-plan
 * modules are the real ones, so a boot that demotes this choice fails here the
 * way it failed on the phone.
 */
const asyncStore: Record<string, string> = {};
const secureStore: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => asyncStore[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      asyncStore[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete asyncStore[key];
    }),
  },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => secureStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStore[key];
  }),
}));
jest.mock("../engine/ModelRegistry", () => ({
  MODEL_REGISTRY: [{ id: "local-a", name: "Local A", contextLength: 8192 }],
  getDefaultModel: () => ({ id: "local-a", name: "Local A" }),
}));
jest.mock("../engine/ModelDownloader", () => ({
  isModelBundleDownloaded: jest.fn(async () => true),
}));
jest.mock("../engine/ModelDownloader.orphanMigration", () => ({
  detectOrphansAtBoot: jest.fn(async () => undefined),
}));
jest.mock("../engine/engineBackend", () => {
  // The backend key is the thing under test, so its real settings stand in;
  // only the engine's own work is stubbed.
  const settings = jest.requireActual(
    "../engine/remote/remoteSettings",
  ) as typeof import("../engine/remote/remoteSettings");
  return {
    beginBackendSwitch: jest.fn(),
    disposeEngine: jest.fn(async () => true),
    endBackendSwitch: jest.fn(),
    getActiveEngineNCtx: jest.fn(() => 0),
    getActiveModelId: jest.fn(() => null),
    initEngine: jest.fn(async () => ({ effectiveNCtx: 32768 })),
    isEngineReady: jest.fn(() => false),
    isRemoteEngineBackend: settings.isRemoteEngineBackend,
    recoverLocalBackend: settings.recoverLocalBackend,
    setEngineBackendMode: settings.setEngineBackendMode,
  };
});
jest.mock("../engine/loadMarker", () => ({
  clearLoadMarker: jest.fn(async () => undefined),
  pickStartModel: jest.fn(() => "local-a"),
  readLastGoodModelId: jest.fn(async () => null),
  readLoadMarker: jest.fn(async () => false),
}));
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  lastExitInfo: jest.fn(() => null),
}));
jest.mock("../engine/remote/remoteComputerModel", () => ({
  REMOTE_COMPUTER_MODEL: {
    id: "kalsa-remote-mac",
    name: "Remote",
    contextLength: 32768,
  },
  REMOTE_COMPUTER_MODEL_ID: "kalsa-remote-mac",
}));
jest.mock("../documents/docOpGate", () => ({ isDeleteActive: jest.fn(() => false) }));
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
  markChatReady: jest.fn(),
  markChatReleased: jest.fn(),
  runNativeOp: jest.fn(async (fn: () => unknown) => fn()),
}));
jest.mock("../bench/benchConfig", () => ({ getBenchNCtx: jest.fn(async () => null) }));
jest.mock("./engineLoad", () => ({ loadMarkerStore: {} }));
jest.mock("./engineEnsure", () => ({ ensureEngineForModel: jest.fn(async () => true) }));
jest.mock("./remoteHostEnsure", () => ({ ensureRemoteHostModel: jest.fn(async () => true) }));
jest.mock("./hostModelDisposal", () => ({ disposeHostModelEngine: jest.fn(async () => true) }));
jest.mock("./modelSwitch", () => ({
  createModelSwitchers: jest.fn(() => ({ selectModel: jest.fn(async () => undefined) })),
}));
jest.mock("./useModelDownload", () => ({
  downloadInFlightRef: { current: false },
  useModelDownload: jest.fn(() => ({})),
}));

import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { ENGINE_BACKEND_KEY } from "../engine/remote/remoteSettings";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { MODEL_STORAGE_KEY } from "./modelSwitchState";
import { ensureRemoteHostModel } from "./remoteHostEnsure";
import { useModelHost, type ModelHostParams } from "./useModelHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOOR_URL = "https://macbook-di-marco.tailnet.ts.net:8443";
const PAIRING_MAP_KEY = "kalsa.pairing.rooms.v2";

function hostParams(): ModelHostParams {
  return {
    t: ((key: string) => key) as ModelHostParams["t"],
    locale: "en",
    thermalHardGated: false,
    thermalHardGateRef: { current: false },
    streamInFlightRef: { current: false },
    conversationsRef: { current: { conversations: [] } as never },
    agentOptions: {} as never,
    agentOptionsRef: { current: {} as never },
    memoryExtractRef: { current: null },
    embedderDownloadedRef: { current: false },
    chatEngineCtxRef: { current: 0 },
  };
}

/** A phone whose computer it picked at 13:31: the backend key, the remote
 *  model id, and the pairing — and no manual address, because the pairing is
 *  the door. */
function deviceAfterPairing(): void {
  asyncStore[ENGINE_BACKEND_KEY] = "remote";
  asyncStore[MODEL_STORAGE_KEY] = REMOTE_COMPUTER_MODEL_ID;
  secureStore[PAIRING_MAP_KEY] = JSON.stringify({
    active: "p1",
    records: [
      {
        localId: "p1",
        credential: "ab".repeat(32),
        doorUrl: DOOR_URL,
        node: null,
        pairedVia: "https",
        roomId: null,
      },
    ],
  });
}

/** One activity's mount, flushed through the boot effect's whole chain. */
async function mountHost(): Promise<{
  root: TestRenderer.ReactTestRenderer;
  host: () => ReturnType<typeof useModelHost>;
}> {
  let latest: ReturnType<typeof useModelHost> | null = null;
  function Probe() {
    latest = useModelHost(hostParams());
    return null;
  }
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(createElement(Probe));
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return { root, host: () => latest! };
}

describe("a recreated activity, with the computer already chosen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(asyncStore)) delete asyncStore[key];
    for (const key of Object.keys(secureStore)) delete secureStore[key];
  });

  it("comes back on the computer and asks it for the model", async () => {
    deviceAfterPairing();
    const mounted = await mountHost();

    expect(mounted.host().remoteActive).toBe(true);
    expect(mounted.host().currentModel.id).toBe(REMOTE_COMPUTER_MODEL_ID);
    // Asked at least once: the boot branch ensures, and the probe that follows
    // re-asks only because this harness's engine never reports itself ready.
    expect(ensureRemoteHostModel).toHaveBeenCalled();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("leaves the stored choice alone: a demotion would strand the phone", async () => {
    deviceAfterPairing();
    const mounted = await mountHost();

    // The S23 failure was not cosmetic: the orphan verdict ran
    // recoverLocalBackend, which rewrote this key to "local", so the next
    // start began on the phone with nothing left to restore.
    expect(asyncStore[ENGINE_BACKEND_KEY]).toBe("remote");
    expect(asyncStore[MODEL_STORAGE_KEY]).toBe(REMOTE_COMPUTER_MODEL_ID);
    act(() => {
      mounted.root.unmount();
    });
  });

  it("stays on the phone when nothing is there to answer on", async () => {
    // No pairing and no typed address: today's behaviour, unchanged.
    asyncStore[ENGINE_BACKEND_KEY] = "remote";
    asyncStore[MODEL_STORAGE_KEY] = REMOTE_COMPUTER_MODEL_ID;
    const mounted = await mountHost();

    expect(mounted.host().remoteActive).toBe(false);
    expect(ensureRemoteHostModel).not.toHaveBeenCalled();
    act(() => {
      mounted.root.unmount();
    });
  });

  it("stays on the phone when the room already refused this pairing", async () => {
    deviceAfterPairing();
    secureStore[PAIRING_MAP_KEY] = secureStore[PAIRING_MAP_KEY].replace(
      '"roomId":null',
      '"roomId":null,"removed":true',
    );
    const mounted = await mountHost();

    expect(mounted.host().remoteActive).toBe(false);
    expect(ensureRemoteHostModel).not.toHaveBeenCalled();
    act(() => {
      mounted.root.unmount();
    });
  });
});