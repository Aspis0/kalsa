/**
 * The pairing entry's routing: the home rows open the PairingScreen. The
 * regression this pins: `pairingOpen` used to lose to the home page's own
 * return, so the tap did nothing (Jelly, APK c6e0b3a9).
 *
 * The same SettingsScreen harness renders the advanced page at the bottom of
 * this file, for the governor switch's initial state.
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
    Platform: { OS: "android", select: (spec: Record<string, unknown>) => spec.default },
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
jest.mock("../ui/labTheme", () => {
  const { palettes } =
    jest.requireActual("../theme/palettes") as typeof import("../theme/palettes");
  return {
    // The advanced page paints from ThemeContext.colors (App.tsx:135): the real
    // light palette, so the page renders without a provider.
    useLabTheme: () => ({
      colors: palettes.light.colors,
      mode: "light",
      setMode: jest.fn(),
      fontScaleId: "m",
      setFontScaleId: jest.fn(),
    }),
  };
});
jest.mock("../theme/typography", () => {
  const actual =
    jest.requireActual("../theme/typography") as typeof import("../theme/typography");
  // The advanced page reads type roles by name (typography.bodyMd.fontSize), so
  // an empty record is not enough there.
  return { useTypography: () => actual.typography, fontFamilies: actual.fontFamilies };
});
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
jest.mock("../components/SendLogPanel", () => ({ SendLogPanel: "SendLogPanel" }));
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
jest.mock("../engine/governorRuntime", () => {
  const actual =
    jest.requireActual("../engine/governorRuntime") as typeof import("../engine/governorRuntime");
  return {
    ...actual,
    // The governor switch paints from the real read; AsyncStorage above is an
    // empty store, i.e. an absent kalsa.governor.enabled.
    writeGovernorEnabled: jest.fn(async () => true),
  };
});
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

// The same SettingsScreen render harness, one question: the governor switch
// reads the real flag, and a store with no kalsa.governor.enabled must paint ON
// (owner decision 2026-10-02).
describe("the governor switch on the advanced page", () => {
  it("starts ON while kalsa.governor.enabled is absent", async () => {
    const renderer = await renderSettings();

    await act(async () => {
      renderer.root
        .findByProps({ testID: "settings.home.advanced" })
        .props.onPress();
    });

    expect(
      renderer.root.findByProps({ accessibilityLabel: "settings.governor" })
        .props.value,
    ).toBe(true);
    await act(async () => renderer.unmount());
  });
});
