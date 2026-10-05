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
/** The theme this file's render harness serves; a case may switch it. */
let mockThemeMode: "light" | "dark" = "light";

jest.mock("../ui/labTheme", () => {
  const { palettes } =
    jest.requireActual("../theme/palettes") as typeof import("../theme/palettes");
  return {
    // The advanced page paints from ThemeContext.colors (App.tsx:135): the real
    // palette of the mode the harness serves, so the page renders without a
    // provider — and a case can render the SAME page in the dark one.
    useLabTheme: () => ({
      colors: palettes[mockThemeMode].colors,
      mode: mockThemeMode,
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
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import type {
  SettingsEmbeddingProps,
  SettingsModelProps,
  SettingsVoiceProps,
} from "./SettingsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { PairingScreen } from "./PairingScreen";
import { modes } from "../theme/design";

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

/** Every colour value the dark tokens own, as the palette the row must paint
 *  from: a literal (or a light-only token) can never be one of these. */
const DARK_TOKENS: string[] = Object.values(modes.dark);

/** WCAG 2.x relative luminance, for the boundary's own floor. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((unit) =>
    unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Every colour-valued style property under one node. */
function coloursUnder(node: ReactTestInstance): Array<{ where: string; colour: string }> {
  const found: Array<{ where: string; colour: string }> = [];
  const props = ["color", "backgroundColor", "borderColor", "borderTopColor", "tintColor", "placeholderTextColor"];
  for (const element of [node, ...node.findAll(() => true)]) {
    const styles = [].concat(element.props?.style ?? []).filter(Boolean);
    for (const style of styles) {
      for (const prop of props) {
        const value = (style as Record<string, unknown>)[prop];
        if (typeof value === "string" && value !== "transparent") {
          found.push({ where: `${String(element.type)}.${prop}`, colour: value });
        }
      }
    }
    for (const prop of ["color", "tintColor", "placeholderTextColor"]) {
      const value = element.props?.[prop];
      if (typeof value === "string" && value !== "transparent") {
        found.push({ where: `${String(element.type)}.${prop}`, colour: value });
      }
    }
  }
  return found;
}

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

describe("the settings rows under the dark theme", () => {
  afterEach(() => {
    mockThemeMode = "light";
  });

  it("paints every home row from the dark tokens — no literal, no light-only token", async () => {
    mockThemeMode = "dark";
    const renderer = await renderSettings(true);

    const rows = renderer.root.findAll(
      (node) =>
        String(node.type) === "Pressable" && typeof node.props.testID === "string" &&
        node.props.testID.startsWith("settings.home."),
    );
    // The assistant, appearance, privacy and engine groups are all there.
    expect(rows.length).toBeGreaterThan(8);

    const strays = rows
      .flatMap((row) => coloursUnder(row))
      .filter((entry) => !DARK_TOKENS.includes(entry.colour));
    expect(strays).toEqual([]);

    // The row the owner named, one token at a time: title, icon, chevron.
    const pair = renderer.root.findByProps({ testID: "settings.home.pair" });
    const pairColours = coloursUnder(pair);
    expect(pairColours.length).toBeGreaterThan(2);
    expect(pair.findAll((node) => String(node.type) === "QrCode")[0].props.color).toBe(
      modes.dark.accent,
    );
    expect(pair.findAll((node) => String(node.type) === "ChevronRight")[0].props.color).toBe(
      modes.dark.ink3,
    );

    // The row separators and the group's own underline are plain Views, so a
    // Pressable-only selection would never see them: each one paints the dark
    // boundary token, and that boundary clears WCAG 1.4.11 on the card it
    // sits on (3.42:1 at this token's value).
    const dividers = renderer.root.findAll((node) => {
      const styles = [].concat(node.props?.style ?? []).filter(Boolean);
      return styles.some(
        (style) =>
          (style as { height?: number }).height === 1 &&
          typeof (style as { backgroundColor?: unknown }).backgroundColor === "string",
      );
    });
    expect(dividers.length).toBeGreaterThanOrEqual(5);
    for (const divider of dividers) {
      const styles = [].concat(divider.props.style).filter(Boolean) as Array<{
        backgroundColor?: string;
      }>;
      const painted = styles.filter((style) => typeof style.backgroundColor === "string");
      expect(painted.map((style) => style.backgroundColor)).toEqual([modes.dark.borderStrong]);
    }
    expect(contrastRatio(modes.dark.borderStrong, modes.dark.surface)).toBeGreaterThanOrEqual(3);

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
