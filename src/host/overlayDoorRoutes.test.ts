import React from "react";

jest.mock("react", () => ({ ...jest.requireActual("react"), useEffect: () => undefined }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ fontScaleId: "m" }) }));
jest.mock("../screens/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
jest.mock("../screens/AccountScreen", () => ({ AccountScreen: "AccountScreen" }));
jest.mock("../screens/ProScreen", () => ({ ProScreen: "ProScreen" }));
jest.mock("../screens/DocumentsScreen", () => ({ DocumentsScreen: "DocumentsScreen" }));
jest.mock("../screens/NotesScreen", () => ({ NotesScreen: "NotesScreen" }));
jest.mock("../screens/PersonasScreen", () => ({ PersonasScreen: "PersonasScreen" }));
jest.mock("../screens/HelpScreen", () => ({ HelpScreen: "HelpScreen" }));
jest.mock("./HostMiniappSheet", () => ({ HostMiniappSheet: "HostMiniappSheet" }));
jest.mock("../engine/ModelRegistry", () => ({
  EMBEDDING_MODEL: { name: "Embedding", sizeBytes: 1 },
  MODEL_REGISTRY: [],
  WHISPER_MODEL: { name: "Voice", sizeBytes: 1 },
  formatBytes: () => "1 B",
}));
jest.mock("../engine/ModelDownloader", () => ({ isModelBundleDownloaded: jest.fn() }));
jest.mock("./modelBar", () => ({ modelErrorHint: () => null }));

import { HostOverlays } from "./HostOverlays";
import type { HostOverlay } from "./hostOverlay";

type Element = React.ReactElement<Record<string, any>>;

function renderOverlay(overlay: HostOverlay, setOverlay: jest.Mock): Element | null {
  return HostOverlays({
    overlay,
    setOverlay,
    onNotice: jest.fn(),
    onNoticeText: jest.fn(),
    refreshMemoryFacts: jest.fn(),
    refreshToolFlags: jest.fn(),
    webToolsEnabled: false,
    toggleWebTools: jest.fn(),
    refreshContextSize: jest.fn(),
    currentModel: { id: "model-a", name: "Model A", sizeBytes: 1 },
    modelState: "idle",
    modelError: null,
    modelErrorDetail: null,
    modelErrorKind: null,
    deviceBandwidth: {},
    streaming: false,
    selectModelById: jest.fn(),
    userReloadModel: jest.fn(),
    confirmDownload: jest.fn(),
    downloadPercent: null,
    downloadedById: {},
    onDownloadedScan: jest.fn(),
    voiceState: "unavailable",
    ttsEnabled: false,
    setTtsEnabled: jest.fn(),
    embeddingState: "unavailable",
    library: { docs: [] },
    addDocument: jest.fn(() => true),
    deleteDocument: jest.fn(async () => true),
    reorderDocuments: jest.fn(),
    updateDocumentPreview: jest.fn(),
    isDocumentDeleteInFlight: jest.fn(() => false),
    setActivePersonaId: jest.fn(),
    refreshPersonas: jest.fn(),
  } as any) as Element | null;
}

describe("Settings and Account overlay doors", () => {
  it("routes both Settings Kalsa actions to their exclusive overlays", () => {
    const setOverlay = jest.fn();
    const settings = renderOverlay({ kind: "settings" }, setOverlay);

    expect(settings?.type).toBe("SettingsScreen");
    settings?.props.onOpenHelp();
    settings?.props.onOpenPro();

    expect(setOverlay.mock.calls).toEqual([
      [{ kind: "help" }],
      [{ kind: "pro", returnTo: "settings" }],
    ]);
  });

  it("preserves Account's Pro route and returns Pro to its originating overlay", () => {
    const accountSetOverlay = jest.fn();
    const account = renderOverlay({ kind: "account" }, accountSetOverlay);
    account?.props.onOpenPro();
    expect(accountSetOverlay).toHaveBeenCalledWith({ kind: "pro", returnTo: "account" });

    const settingsSetOverlay = jest.fn();
    const settingsPro = renderOverlay({ kind: "pro", returnTo: "settings" }, settingsSetOverlay);
    settingsPro?.props.onBack();
    expect(settingsSetOverlay).toHaveBeenCalledWith({ kind: "settings" });

    const accountPro = renderOverlay({ kind: "pro", returnTo: "account" }, accountSetOverlay);
    accountPro?.props.onBack();
    expect(accountSetOverlay).toHaveBeenLastCalledWith({ kind: "account" });
  });
});
