import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  beginBackendSwitch,
  disposeRemoteEngine,
  endBackendSwitch,
  saveEngineSession,
  setEngineBackendMode,
} from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { createModelSwitchers } from "./modelSwitch";
import { modelSwitchInFlightRef, subscribeModelSwitchSettled } from "./modelSwitchState";

jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock("../engine/engineBackend", () => ({
  beginBackendSwitch: jest.fn(),
  disposeEngine: jest.fn(async () => undefined),
  disposeRemoteEngine: jest.fn(async () => undefined),
  endBackendSwitch: jest.fn(),
  getActiveModelId: jest.fn(() => null),
  isEngineReady: jest.fn(() => false),
  isRemoteEngineBackend: jest.fn(() => true),
  saveEngineSession: jest.fn(async () => true),
  setEngineBackendMode: jest.fn(async () => undefined),
}));
jest.mock("../engine/llamaContextGate", () => ({
  markChatReleased: jest.fn(),
  nativeOpBusy: jest.fn(() => false),
  runNativeOpBounded: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../engine/sessionPersistence", () => ({
  computeHistoryHashFromMessages: jest.fn(() => "hash"),
  readBootMessages: jest.fn(async () => []),
}));
jest.mock("../engine/loadMarker", () => ({ clearLoadMarker: jest.fn(async () => undefined) }));
jest.mock("./engineLoad", () => ({ loadMarkerStore: {} }));
jest.mock("./engineGateHelpers", () => ({ MODEL_SWITCH_DISPOSE_TIMEOUT_MS: 1000 }));
jest.mock("./useModelDownload", () => ({ downloadInFlightRef: { current: false } }));
jest.mock("../engine/regenState", () => ({
  deferModelSwitchIfSendClaimed: jest.fn(() => false),
  drainPendingModelSwitch: jest.fn(() => null),
  regenInFlightRef: { current: false },
  sendClaimRef: { current: false },
  sendingInFlightRef: { current: false },
}));

const translate = (key: string) => key;

function switchDeps(overrides: Record<string, unknown> = {}) {
  return {
    t: translate,
    thermalHardGateRef: { current: false },
    engineGenerationRef: { current: 0 },
    modelIndexRef: { current: 0 },
    chatGateGenRef: { current: 9 },
    modelStateRef: { current: "ready" },
    streamInFlightRef: { current: false },
    memoryExtractRef: { current: null },
    remoteActiveRef: { current: true },
    setRemoteActive: jest.fn(),
    setModelIndex: jest.fn(),
    setModelState: jest.fn(),
    setModelError: jest.fn(),
    setModelErrorKind: jest.fn(),
    setModelErrorDetail: jest.fn(),
    ...overrides,
  };
}

describe("local selection leaves remote mode through the model switcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelSwitchInFlightRef.current = false;
  });

  test("selecting the already-selected local row disposes remote and restores local backend", async () => {
    const deps = switchDeps();
    const switchers = createModelSwitchers(deps as never);
    let settled = 0;
    const unsubscribe = subscribeModelSwitchSettled(() => { settled += 1; });

    await switchers.selectModel(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(disposeRemoteEngine).toHaveBeenCalledTimes(1);
    expect(setEngineBackendMode).toHaveBeenCalledWith("local");
    expect(deps.remoteActiveRef.current).toBe(false);
    expect(deps.setRemoteActive).toHaveBeenCalledWith(false);
    expect(deps.setModelIndex).toHaveBeenCalledWith(0);
    expect(saveEngineSession).not.toHaveBeenCalled();
    expect(beginBackendSwitch).toHaveBeenCalledWith("local");
    expect(endBackendSwitch).toHaveBeenCalledTimes(1);
    expect(modelSwitchInFlightRef.current).toBe(false);
    expect(settled).toBe(1);
    unsubscribe();
  });

  test("the id selector forwards the remote row before looking for a local catalog row", () => {
    const routeModelById = jest.fn(() => true);
    const switchers = createModelSwitchers(switchDeps({ routeModelById }) as never);

    switchers.selectModelById(REMOTE_COMPUTER_MODEL_ID);

    expect(routeModelById).toHaveBeenCalledWith(REMOTE_COMPUTER_MODEL_ID);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
