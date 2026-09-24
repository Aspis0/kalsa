import React from "react";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { createRemoteModelHostActions } from "../host/remoteModelHostActions";
import { switchHostToRemoteComputer } from "../host/remoteModelTransition";
import { SettingsHomeScreen } from "./SettingsHomeScreen";

let strings: Record<string, string> = {};
let hookValues: unknown[] = [];
let hookCursor = 0;

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: (initial: unknown) => {
    const index = hookCursor++;
    if (!Object.prototype.hasOwnProperty.call(hookValues, index)) hookValues[index] = initial;
    return [hookValues[index], (value: unknown) => { hookValues[index] = value; }];
  },
}));
jest.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("../i18n", () => ({
  useLocale: () => ({
    t: (key: string) => strings[key] ?? key,
    locale: "en",
    setLocale: jest.fn(),
  }),
}));
jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({ mode: "light", setMode: jest.fn(), fontScaleId: "m", setFontScaleId: jest.fn() }),
}));
jest.mock("./SettingsHeader", () => ({ SettingsHeader: "SettingsHeader" }));
jest.mock("../ui/shell/AttachSheet", () => ({ AttachSheet: "AttachSheet" }));
jest.mock("../../assets/icon.png", () => "brand-mark");
jest.mock("../documents/docOpGate", () => ({ isDeleteActive: jest.fn(() => false) }));
jest.mock("../engine/regenState", () => ({ regenInFlightRef: { current: false } }));
jest.mock("../host/useModelDownload", () => ({ downloadInFlightRef: { current: false } }));
jest.mock("../host/modelSwitchState", () => ({ modelSwitchInFlightRef: { current: false } }));
jest.mock("../host/remoteModelTransition", () => ({ switchHostToRemoteComputer: jest.fn() }));
jest.mock("../host/useNotice", () => ({ noticePort: { current: null } }));

type Element = React.ReactElement<Record<string, any>>;
type Catalog = typeof en;

function flatten(catalog: object, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") Object.assign(out, flatten(value, path));
  }
  return out;
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  const nested = typeof element.type === "function"
    ? (element.type as (props: any) => React.ReactNode)(element.props)
    : element.props.children;
  return [element, ...elements(nested)];
}

function makeHostActions(remoteActive: boolean) {
  const ports = {
    t: (key: string) => key,
    engineGenerationRef: { current: 0 },
    chatGateGenRef: { current: null },
    markChatReleased: jest.fn(),
    remoteActiveRef: { current: remoteActive },
    setRemoteActive: jest.fn(),
    modelStateRef: { current: remoteActive ? "error" : "ready" },
    streamInFlightRef: { current: false },
    setModelState: jest.fn(),
    setModelError: jest.fn(),
    setModelErrorKind: jest.fn(),
    setModelErrorDetail: jest.fn(),
    disposeCurrent: jest.fn(async () => true),
    ensureRemote: jest.fn(async () => true),
    selectLocalModel: jest.fn(),
  };
  return { actions: createRemoteModelHostActions(ports as never), ports };
}

function mount(catalog: Catalog, remoteActive: boolean) {
  strings = flatten(catalog);
  hookValues = [];
  hookCursor = 0;
  const { actions, ports } = makeHostActions(remoteActive);
  const props: Parameters<typeof SettingsHomeScreen>[0] = {
    onBack: jest.fn(),
    onOpenAdvanced: jest.fn(),
    onOpenHelp: jest.fn(),
    onOpenPro: jest.fn(),
    modelOptions: [
      { id: "lfm2.5-2.6b", label: "LFM2.5 2.6B", detail: "QAD-Q4_0", sizeClass: "2B", disabled: false },
    ],
    currentModelId: remoteActive ? REMOTE_COMPUTER_MODEL_ID : "lfm2.5-2.6b",
    remoteActive,
    modelBusy: false,
    onSelectModel: jest.fn(),
    onSelectLocation: (location) => actions.selectLocation(location, "lfm2.5-2.6b"),
    telemetryEnabled: false,
    telemetryBusy: false,
    onToggleTelemetry: jest.fn(),
    deviceToolsEnabled: false,
    onToggleDeviceTools: jest.fn(),
    calendarToolsEnabled: false,
    onToggleCalendarTools: jest.fn(),
    appVersion: "1.0",
  };
  const render = () => {
    hookCursor = 0;
    return elements(SettingsHomeScreen(props));
  };
  return { actions, ports, render };
}

function textInRow(nodes: Element[], testID: string) {
  const row = nodes.find((node) => node.props.testID === testID);
  return elements(row).filter((node) => node.type === "Text").map((node) => node.props.children);
}

describe("Settings where-answers row", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    strings = {};
    hookValues = [];
    hookCursor = 0;
  });

  it.each([["English", en], ["Italian", italian]] as const)("renders the active location in %s", (_locale, catalog) => {
    const local = mount(catalog, false).render();
    expect(textInRow(local, "settings.home.where")).toEqual([
      catalog.settings.whereRuns,
      catalog.settings.thisPhone,
    ]);

    const remote = mount(catalog, true).render();
    expect(textInRow(remote, "settings.home.where")).toEqual([
      catalog.settings.whereRuns,
      catalog.shell.where.pillComputer,
    ]);
  });

  it.each([["local", false], ["remote", true]] as const)("opens the choice with the active %s option marked", (_mode, remoteActive) => {
    const { render } = mount(en, remoteActive);
    let nodes = render();
    nodes.find((node) => node.type === "Pressable" && node.props.testID === "settings.home.where")?.props.onPress();
    nodes = render();
    const sheet = nodes.find((node) => node.type === "AttachSheet");
    expect(sheet?.props.title).toBe(en.settings.whereRuns);
    expect(sheet?.props.rows.map((row: { testID: string; label: string; role: string; selected: boolean }) => ({
      testID: row.testID,
      label: row.label,
      role: row.role,
      selected: row.selected,
    }))).toEqual([
      { testID: "settings.sheet.where.local", label: en.settings.thisPhone, role: "radio", selected: !remoteActive },
      { testID: "settings.sheet.where.remote", label: en.shell.where.pillComputer, role: "radio", selected: remoteActive },
    ]);
    const destination = remoteActive ? "settings.sheet.where.local" : "settings.sheet.where.remote";
    sheet?.props.rows.find((row: { testID: string }) => row.testID === destination)?.onPress();
    if (remoteActive) expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    else expect(switchHostToRemoteComputer).toHaveBeenCalledTimes(1);
  });

  it("returns from an unreachable computer through the host local selector", () => {
    const { ports, render } = mount(en, true);
    let nodes = render();
    nodes.find((node) => node.type === "Pressable" && node.props.testID === "settings.home.where")?.props.onPress();
    nodes = render();
    const sheet = nodes.find((node) => node.type === "AttachSheet");
    sheet?.props.rows.find((row: { testID: string }) => row.testID === "settings.sheet.where.local")?.onPress();
    expect(ports.selectLocalModel).toHaveBeenCalledWith("lfm2.5-2.6b");
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
  });
});
