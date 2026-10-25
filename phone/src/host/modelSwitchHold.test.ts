/**
 * The switch's composer-visible transition (luna): `checking` must be on
 * screen from the TAP, before the marker-clear storage await — sends are
 * refused for the whole switch (`sendHost`), so an idle composer across the
 * await would refuse them with no visible reason. The selection flip itself
 * still waits for the clear (the comment that says so must stay true), and
 * the dispose-timeout log must name the way out that actually exists — the
 * load path, not a re-select that the same-index guard would swallow.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { readFileSync } from "fs";
import { join } from "path";
import { clearLoadMarker } from "../engine/loadMarker";
import { createModelSwitchers } from "./modelSwitch";
import { modelSwitchInFlightRef } from "./modelSwitchState";

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
  isRemoteEngineBackend: jest.fn(() => false),
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

function switchDeps() {
  return {
    t: translate,
    thermalHardGateRef: { current: false },
    engineGenerationRef: { current: 0 },
    modelIndexRef: { current: 0 },
    chatGateGenRef: { current: 9 },
    modelStateRef: { current: "ready" },
    streamInFlightRef: { current: false },
    memoryExtractRef: { current: null },
    remoteActiveRef: { current: false },
    setRemoteActive: jest.fn(),
    setModelIndex: jest.fn(),
    setModelState: jest.fn(),
    setModelError: jest.fn(),
    setModelErrorKind: jest.fn(),
    setModelErrorDetail: jest.fn(),
  };
}

const MODEL_SWITCH_SOURCE = readFileSync(join(__dirname, "modelSwitch.ts"), "utf8");

describe("the switch shows its hold before its first await", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelSwitchInFlightRef.current = false;
  });
  afterEach(() => {
    modelSwitchInFlightRef.current = false;
  });

  test("checking is on screen while the marker clear is still pending; the flip still waits for the clear", async () => {
    let releaseMarker!: () => void;
    jest.mocked(clearLoadMarker).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseMarker = resolve;
        }),
    );
    const deps = switchDeps();
    const switchers = createModelSwitchers(deps as never);

    const switching = switchers.selectModel(1);
    await Promise.resolve();

    // The hold is up across the storage await…
    expect(clearLoadMarker).toHaveBeenCalledTimes(1);
    expect(deps.setModelState).toHaveBeenCalledWith("checking");
    // …while the selection flip itself still waits for the clear (the kept
    // comment's claim), so the load-gate kick cannot read a stale marker.
    expect(deps.setModelIndex).not.toHaveBeenCalled();

    releaseMarker();
    await switching;
    expect(deps.setModelIndex).toHaveBeenCalledWith(1);
  });

  test("the dispose-timeout log names the way out that exists, not a swallowed re-select", () => {
    // Reverted text would promise a retry that selectModel's same-index guard
    // refuses — a log that lies about recovery is worse than no log.
    expect(MODEL_SWITCH_SOURCE).not.toContain("the switch can be retried");
    expect(MODEL_SWITCH_SOURCE).toContain("load the picked model to retry");
  });
});
