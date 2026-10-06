import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("expo-file-system/legacy", () => ({
  getInfoAsync: jest.fn(),
}));
jest.mock("react-native", () => ({
  Alert: { alert: jest.fn() },
  Linking: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    getInitialURL: jest.fn(async () => null),
  },
}));
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
  isModelBundleDownloaded: jest.fn(async (model: { id: string }) => {
    const fs = jest.requireMock("expo-file-system/legacy") as {
      getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
    };
    return (await fs.getInfoAsync(model.id)).exists;
  }),
}));
jest.mock("../engine/ModelRegistry", () => ({
  MODEL_REGISTRY: [{ id: "local", sizeBytes: 1, name: "Local" }],
  EMBEDDING_MODEL: { id: "embedding", sizeBytes: 1, name: "Embedding" },
  WHISPER_MODEL: { id: "voice", sizeBytes: 1, name: "Voice" },
  formatBytes: jest.fn(() => "1 B"),
}));
jest.mock("../engine/platformThermalStatus", () => ({
  getPlatformThermalHardGate: jest.fn(async () => false),
}));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ fontScaleId: "m" }) }));
jest.mock("../screens/SettingsScreen", () => ({ SettingsScreen: () => null }));
jest.mock("../screens/AccountScreen", () => ({ AccountScreen: () => null }));
jest.mock("../screens/ProScreen", () => ({ ProScreen: () => null }));
jest.mock("../screens/DocumentsScreen", () => ({ DocumentsScreen: () => null }));
jest.mock("../screens/NotesScreen", () => ({ NotesScreen: () => null }));
jest.mock("../screens/PersonasScreen", () => ({ PersonasScreen: () => null }));
jest.mock("../screens/HelpScreen", () => ({ HelpScreen: () => null }));
jest.mock("../screens/RoomScreen", () => ({ RoomScreen: () => null }));
jest.mock("./HostMiniappSheet", () => ({ HostMiniappSheet: () => null }));
jest.mock("./HostConversations", () => ({ HostConversations: () => null }));
jest.mock("./HostNotice", () => ({ HostNotice: () => null }));
jest.mock("../pdf/PdfTextExtractorHost", () => ({ PdfTextExtractorHost: () => null }));
jest.mock("./downloadNotifications", () => ({ createDownloadNotifications: jest.fn() }));
jest.mock("./confirmDownloadGate", () => ({ confirmDownloadGate: jest.fn() }));
jest.mock("./confirmGateWarning", () => ({ confirmGateWarning: jest.fn() }));
jest.mock("./engineGateHelpers", () => ({
  gateForModel: jest.fn(),
  gateReasonMessage: jest.fn(),
  rawErrorDetail: jest.fn(),
}));
jest.mock("./useNotice", () => ({ noticePort: { current: null } }));

import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import type { ModelInfo } from "../engine/ModelRegistry";
import { HostFurniture, type HostFurnitureProps } from "./HostFurniture";
import { useModelDownload } from "./useModelDownload";
import type { ModelDownloadDeps } from "./useModelDownload";

const MODEL = { id: "local", sizeBytes: 1, name: "Local" } as ModelInfo;
const DOWNLOAD_DEPS: ModelDownloadDeps = {
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

let previousActEnvironment: boolean | undefined;
let consoleError: jest.SpyInstance;

beforeEach(() => {
  previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error.bind(console);
  consoleError = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    originalError(...args);
  });
  (FileSystem.getInfoAsync as jest.Mock).mockReset();
});

afterEach(() => {
  consoleError.mockRestore();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    previousActEnvironment;
});

describe("Settings model-presence scan", () => {
  test("the real overlay scan publishes once through the download hook", async () => {
    const pendingReads: Array<(info: { exists: boolean }) => void> = [];
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(
      () => new Promise((resolve) => pendingReads.push(resolve)),
    );
    let publishedMap: Record<string, boolean> = {};

    function Probe() {
      const download = useModelDownload(DOWNLOAD_DEPS);
      publishedMap = download.downloadedById;
      const modelHost = {
        currentModel: MODEL,
        remoteActive: false,
        modelState: "missing",
        modelError: null,
        modelErrorDetail: null,
        modelErrorKind: null,
        deviceBandwidth: {},
        selectLocation: () => true,
        selectModelById: () => undefined,
        userReloadModel: () => undefined,
        confirmDownload: () => undefined,
        download: null,
        downloadedById: download.downloadedById,
        applyDownloadedScan: download.applyDownloadedScan,
        refreshContextSize: async () => undefined,
        scans: {
          voiceState: "missing",
          ttsEnabled: true,
          setTtsEnabled: () => undefined,
          embeddingState: "missing",
        },
      } as unknown as HostFurnitureProps["modelHost"];
      const props = {
        overlay: { kind: "settings" },
        setOverlay: () => undefined,
        onNotice: () => undefined,
        onNoticeText: () => undefined,
        notice: null,
        memory: { refreshMemoryFacts: async () => undefined },
        flags: {
          refreshToolFlags: async () => undefined,
          webToolsEnabled: false,
          toggleWebTools: () => undefined,
        },
        library: {},
        personas: { setActivePersonaId: () => undefined, refreshPersonas: async () => undefined },
        conv: {},
        conversationActions: {},
        onExportPress: () => undefined,
        modelHost,
        streaming: false,
      } as unknown as HostFurnitureProps;
      return createElement(HostFurniture, props);
    }

    let root!: ReactTestRenderer;
    try {
      act(() => {
        root = create(createElement(Probe));
      });
      expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(1);
      expect(pendingReads).toHaveLength(1);

      await act(async () => {
        pendingReads[0]!({ exists: true });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(publishedMap).toEqual({ local: true });
      expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(1);
      expect(isModelBundleDownloaded).toHaveBeenCalledTimes(1);
    } finally {
      if (root) act(() => root.unmount());
    }
  });
});
