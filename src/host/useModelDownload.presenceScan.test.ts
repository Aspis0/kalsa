import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("expo-file-system/legacy", () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));
jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock("../app/foregroundIdleDispose", () => ({
  bumpForegroundIdleRef: { current: jest.fn() },
}));
jest.mock("../engine/ModelDownloader", () => ({
  downloadModelBundle: jest.fn(),
  friendlyNetworkError: jest.fn(),
  isModelBundleDownloaded: async () => {
    const fs = jest.requireMock("expo-file-system/legacy") as typeof FileSystem;
    return (await fs.getInfoAsync("model")).exists;
  },
}));
jest.mock("../engine/ModelRegistry", () => ({
  MODEL_REGISTRY: [{ id: "local", sizeBytes: 1 }],
  formatBytes: jest.fn(),
}));
jest.mock("../engine/platformThermalStatus", () => ({
  getPlatformThermalHardGate: jest.fn(async () => false),
}));
jest.mock("./downloadNotifications", () => ({
  createDownloadNotifications: jest.fn(),
}));
jest.mock("./confirmDownloadGate", () => ({ confirmDownloadGate: jest.fn() }));
jest.mock("./confirmGateWarning", () => ({ confirmGateWarning: jest.fn() }));
jest.mock("./engineGateHelpers", () => ({
  gateForModel: jest.fn(),
  gateReasonMessage: jest.fn(),
  rawErrorDetail: jest.fn(),
}));
jest.mock("./useNotice", () => ({ noticePort: { current: null } }));

import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import { useModelDownload } from "./useModelDownload";
import type { ModelDownloadDeps } from "./useModelDownload";

const deps: ModelDownloadDeps = {
  t: (key) => key,
  locale: "en",
  thermalHardGated: false,
  thermalHardGateRef: { current: false },
  engineGenerationRef: { current: 0 },
  modelIndexRef: { current: 0 },
  modelStateRef: { current: "missing" },
  ensureEngineForModelRef: { current: async () => true },
  deviceBandwidth: {},
  setModelState: jest.fn(),
  setModelError: jest.fn(),
  setModelErrorKind: jest.fn(),
  setModelErrorDetail: jest.fn(),
};

describe("Settings model-presence scan", () => {
  test("publishing its result does not restart the filesystem scan", async () => {
    let scanCount = 0;
    function SettingsOpenProbe() {
      const { applyDownloadedScan } = useModelDownload(deps);
      useEffect(() => {
        let mounted = true;
        void (async () => {
          scanCount += 1;
          const exists = await isModelBundleDownloaded({ id: "local" } as never);
          if (mounted) applyDownloadedScan({ local: exists });
        })();
        return () => {
          mounted = false;
        };
      }, [applyDownloadedScan]);
      return null;
    }

    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    let root!: ReactTestRenderer;
    act(() => {
      root = create(createElement(SettingsOpenProbe));
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    act(() => root.unmount());
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    consoleError.mockRestore();

    expect(scanCount).toBe(1);
    expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(1);
  });
});
