/**
 * The pairing entry's routing: the home rows open the PairingScreen. The
 * regression this pins: `pairingOpen` used to lose to the home page's own
 * return, so the tap did nothing (Jelly, APK c6e0b3a9).
 */

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("ActivityIndicator"),
    Alert: { alert: jest.fn() },
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Image: host("Image"),
    Linking: { openSettings: jest.fn(async () => undefined) },
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    Switch: host("Switch"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("../i18n", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", setLocale: jest.fn() }),
}));
jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({ mode: "light", setMode: jest.fn(), fontScaleId: "m", setFontScaleId: jest.fn() }),
}));
jest.mock("../theme/typography", () => ({
  useTypography: () => ({}),
  fontFamilies: {},
}));
jest.mock("../theme/components", () => {
  const react = require("react") as typeof import("react");
  return {
    GlassPanel2: (props: Record<string, unknown>) =>
      react.createElement("GlassPanel2", null, props.children as React.ReactNode),
  };
});
jest.mock("./SettingsHeader", () => ({
  SettingsHeader: (props: Record<string, unknown>) =>
    require("react").createElement("SettingsHeader", props),
}));
jest.mock("./RemoteBrainSettings", () => ({ RemoteBrainSettings: "RemoteBrainSettings" }));
jest.mock("./PairingQrScanner", () => ({
  PairingQrScanner: (props: Record<string, unknown>) =>
    require("react").createElement("PairingQrScanner", props),
}));
jest.mock("../ui/shell/AttachSheet", () => ({ AttachSheet: "AttachSheet" }));
jest.mock("../components/OrphanModelMigrationBanner", () => ({
  OrphanModelMigrationBanner: "OrphanModelMigrationBanner",
}));
jest.mock("../../assets/icon.png", () => "brand-mark");
jest.mock("expo-constants", () => ({ expoConfig: undefined }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock("../engine/engineBackend", () => ({
  testRemoteConnection: jest.fn(async () => ({ ok: true, modelId: "ornith" })),
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(async () => null),
}));
jest.mock("../engine/remote/remoteSettings", () => ({
  getRemoteBrainUrl: jest.fn(() => ""),
  // PairingScreen imports this one; no ceremony runs in this file.
  setRemoteServerModelId: jest.fn(async () => undefined),
}));
jest.mock("../search", () => ({
  getActiveProviderId: jest.fn(async () => "exa"),
  getSecret: jest.fn(async () => null),
  setSecret: jest.fn(async () => undefined),
  setActiveProviderId: jest.fn(),
  PROVIDER_IDS: ["exa"],
  PROVIDERS: {
    exa: { needsKey: true, keyPlaceholder: "key" },
    brave: { needsKey: true, keyPlaceholder: "key" },
    tavily: { needsKey: true, keyPlaceholder: "key" },
    "exa-mcp": { needsKey: false },
  },
}));
jest.mock("../bench/benchConfig", () => ({
  getBenchNCtx: jest.fn(async () => 0),
  getBenchNoRepack: jest.fn(async () => false),
  getEngineOverride: jest.fn(async () => null),
  getThinkingMode: jest.fn(async () => null),
  setThinkingMode: jest.fn(async () => undefined),
}));
jest.mock("../engine/EmbeddingService", () => ({ isEmbedderHung: jest.fn(() => false) }));
jest.mock("../engine/deviceProfile", () => ({
  getCachedDeviceProfile: jest.fn(async () => null),
  getFreeDiskBytes: jest.fn(async () => 0),
  modelGateVerdict: jest.fn(() => ({ allowed: true })),
  evaluateModelFit: jest.fn(),
  diskRequirementBytes: jest.fn((bytes: number) => bytes),
}));
jest.mock("../engine/contextProfile", () => ({
  getDeviceTotalMemoryBytes: jest.fn(() => null),
  getRamTier: jest.fn(() => "unknown"),
  ramTierMeets: jest.fn(() => true),
  recommendedModelId: jest.fn(() => null),
  resolveContextProfile: jest.fn(() => ({ nCtx: 0 })),
}));
jest.mock("../engine/modelGateRAM", () => ({
  gateCacheOptionFit: jest.fn(() => ({ allowed: true })),
  gateContextOptionFit: jest.fn(() => ({ allowed: true })),
  gateNonEvictableMiB: jest.fn(() => 0),
  optionAvailability: jest.fn(() => ({})),
}));
jest.mock("../engine/loadPolicy", () => ({ resolveGateLoadPolicy: jest.fn(() => null) }));
jest.mock("../engine/governorRuntime", () => ({
  readGovernorEnabled: jest.fn(async () => false),
  writeGovernorEnabled: jest.fn(async () => undefined),
}));
jest.mock("../engine/deviceTuning", () => ({ resolveEngineTuningSync: jest.fn(() => null) }));
jest.mock("../engine/kvQuantCost", () => ({
  kvBytesPerTokenAtProfile: jest.fn(() => 0),
  modelAtKvProfile: jest.fn(() => null),
}));
jest.mock("../engine/monitor", () => ({ getAvailableMemoryBytesUncached: jest.fn(async () => 0) }));
jest.mock("../hooks/useProcessHealth", () => ({ useProcessHealth: jest.fn(() => ({})) }));
jest.mock("../hooks/useThermalMonitor", () => ({ useThermalMonitor: jest.fn(() => ({})) }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import type {
  SettingsEmbeddingProps,
  SettingsModelProps,
  SettingsVoiceProps,
} from "./SettingsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { PairingScreen } from "./PairingScreen";

const model: SettingsModelProps = {
  currentModelId: "local-model",
  remoteActive: false,
  onSelectLocation: jest.fn(() => true),
  modelState: "ready",
  downloadPercent: null,
  modelError: null,
  modelErrorHint: null,
  modelErrorKind: null,
  streaming: false,
  downloadedById: {},
  deviceBandwidth: {} as DeviceBandwidthCalibration,
  onSelectModel: jest.fn(),
  onDownloadModel: jest.fn(),
  onRetryLoad: jest.fn(),
};

const voice: SettingsVoiceProps = {
  state: "missing",
  downloadPercent: null,
  error: null,
  ttsEnabled: false,
  modelName: "",
  modelSizeLabel: "",
  onDownload: jest.fn(),
  onToggleTts: jest.fn(),
};

const embedding: SettingsEmbeddingProps = {
  state: "missing",
  downloadPercent: null,
  error: null,
  modelName: "",
  modelSizeLabel: "",
  onDownload: jest.fn(),
};

async function renderSettings(remoteActive = false): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(SettingsScreen, {
        onBack: jest.fn(),
        onOpenHelp: jest.fn(),
        model: { ...model, remoteActive },
        voice,
        embedding,
      }),
    );
  });
  return renderer;
}

describe("the pairing entry on the home page", () => {
  it("opens the PairingScreen from the settings.home.pair row", async () => {
    const renderer = await renderSettings();
    expect(renderer.root.findAllByType(PairingScreen)).toHaveLength(0);

    await act(async () => {
      renderer.root.findByProps({ testID: "settings.home.pair" }).props.onPress();
    });

    expect(renderer.root.findAllByType(PairingScreen)).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  it("opens the PairingScreen from the where-section primary action", async () => {
    const renderer = await renderSettings(true);

    await act(async () => {
      renderer.root.findByProps({ testID: "settings.home.pair.primary" }).props.onPress();
    });

    expect(renderer.root.findAllByType(PairingScreen)).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});
