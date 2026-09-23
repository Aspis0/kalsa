import React from "react";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import { HelpScreen } from "./HelpScreen";
import { ProScreen } from "./ProScreen";
import { SettingsHomeScreen } from "./SettingsHomeScreen";

let mockStrings: Record<string, string> = {};
let mockHookValues: unknown[] = [];
let mockHookCursor = 0;

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = mockHookCursor++;
    if (!Object.prototype.hasOwnProperty.call(mockHookValues, index)) mockHookValues[index] = initial;
    return [mockHookValues[index], (value: unknown) => { mockHookValues[index] = value; }];
  },
}));
jest.mock("react-native", () => ({
  BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
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
    t: (key: string) => mockStrings[key] ?? key,
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

function useCatalog(catalog: Catalog) {
  mockStrings = flatten(catalog);
  mockHookValues = [];
  mockHookCursor = 0;
}

function homeText(catalog: Catalog, modelId: string) {
  useCatalog(catalog);
  const tree = SettingsHomeScreen({
    onBack: jest.fn(),
    onOpenAdvanced: jest.fn(),
    onOpenHelp: jest.fn(),
    onOpenPro: jest.fn(),
    modelOptions: [
      { id: "lfm2.5-2.6b", label: "LFM2.5 2.6B", detail: "QAD-Q4_0", sizeClass: "2B", disabled: false },
      { id: "qwen3.5-4b", label: "Qwen 3.5 4B", detail: "Q4_K_M", sizeClass: "4B", disabled: false },
    ],
    currentModelId: modelId,
    modelBusy: false,
    onSelectModel: jest.fn(),
    telemetryEnabled: false,
    telemetryBusy: false,
    onToggleTelemetry: jest.fn(),
    deviceToolsEnabled: false,
    onToggleDeviceTools: jest.fn(),
    calendarToolsEnabled: false,
    onToggleCalendarTools: jest.fn(),
    appVersion: "1.0",
  });
  return elements(tree)
    .filter((node) => node.type === "Text")
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === "string");
}

const HELP_SECTIONS = ["about", "modelLocation", "deviceData", "computer", "models", "privacy"] as const;

beforeEach(() => {
  mockStrings = {};
  mockHookValues = [];
  mockHookCursor = 0;
});

describe("copy that remains truthful across local and computer modes", () => {
  it.each([["English", en], ["Italian", italian]] as const)("renders the six Help sections and guards the location disclosure in %s", (_name, catalog) => {
    useCatalog(catalog);
    const help = elements(HelpScreen({ onBack: jest.fn() }));
    const rendered = help
      .filter((node) => node.type === "Text")
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === "string");
    expect(rendered).toEqual(HELP_SECTIONS.flatMap((section) => [
      catalog.help[section].title,
      catalog.help[section].body,
      ...(section === "privacy" ? [catalog.help.privacy.voice] : []),
    ]));

    const location = catalog.help.modelLocation.body;
    const disclosure = "To answer, your computer receives the conversation: messages, notes you attach, memory, summaries and document names.";
    const disclosureIt = "Per rispondere, il tuo computer riceve la conversazione: messaggi, note che alleghi, memoria, riassunti e nomi dei documenti.";
    expect(location).toMatch(catalog === en ? /local mode/i : /modalità locale/i);
    expect(location).toMatch(catalog === en ? /this phone/i : /questo telefono/i);
    expect(location).toMatch(catalog === en ? /your computer/i : /tuo computer/i);
    expect(location).toContain("Kalsa desktop");
    expect(location).toContain(catalog === en ? disclosure : disclosureIt);
    expect(location).toMatch(catalog === en
      ? /tools, memory extraction, translation and embeddings stay off/i
      : /restano disattivati strumenti, estrazione della memoria, traduzione ed embedding/i);
    expect(catalog.help.deviceData.body).toMatch(catalog === en
      ? /files themselves are not sent/i
      : /file non vengono inviati/i);

    const body = rendered.filter((_, index) => index % 2 === 1).join(" ");
    expect(body).not.toMatch(/chat runs fully on your phone|la chat gira interamente sul telefono|Kalsa runs fully on this device|Kalsa gira interamente su questo dispositivo|100% local|100% locale|everything stays on this phone|tutto resta su questo telefono/i);
    expect(catalog.help.computer.body).toMatch(catalog === en ? /when computer mode is available/i : /quando la modalità computer sarà disponibile/i);
    expect(body).not.toMatch(/QR|camera|scan(?:ning)?|fotocamera|scansion/i);
    expect(body).not.toMatch(/Remote brain|Cervello remoto/i);
  });

  it.each([["English", en], ["Italian", italian]] as const)("shows Pro benefits and no purchase action in %s", (_name, catalog) => {
    useCatalog(catalog);
    const pro = elements(ProScreen({ onBack: jest.fn() }));
    const text = pro.filter((node) => node.type === "Text").map((node) => node.props.children);
    expect(text).toEqual(expect.arrayContaining([
      catalog.account.proHero,
      catalog.account.proAvailability,
      catalog.account.proUnlocksTitle,
      catalog.account.proComputerBenefit,
      catalog.account.proSearchBenefit,
      catalog.account.proUnchangedTitle,
      catalog.account.proUnchangedBody,
    ]));
    expect(pro.filter((node) => node.type === "Pressable")).toHaveLength(0);
    expect(text.join(" ")).not.toMatch(/\$|€|\/month|\/mese|subscribe|abbonati|upgrade to pro|passa a pro/i);
  });

  it.each([["English", en], ["Italian", italian]] as const)("keeps the Settings location and model guidance tied to their rendered rows in %s", (_name, catalog) => {
    expect(homeText(catalog, "lfm2.5-2.6b")).toEqual(expect.arrayContaining([
      catalog.settings.whereRunsHint,
      catalog.settings.modelSmallFast,
      "LFM2.5 2.6B · QAD-Q4_0",
    ]));
    expect(homeText(catalog, "qwen3.5-4b")).toEqual(expect.arrayContaining([
      catalog.settings.whereRunsHint,
      catalog.settings.modelCapableSlow,
      "Qwen 3.5 4B · Q4_K_M",
    ]));
  });

  it.each([["English", en], ["Italian", italian]] as const)("scopes privacy and prompt claims while preserving true device-only statements in %s", (_name, catalog) => {
    expect(catalog.settings.privacyBody).toContain(catalog === en
      ? "In local mode, the model runs on this device."
      : "In modalità locale, il modello gira su questo dispositivo.");
    expect(catalog.settings.privacyBody).toContain(catalog === en
      ? "To answer, your computer receives the conversation: messages, notes you attach, memory, summaries and document names."
      : "Per rispondere, il tuo computer riceve la conversazione: messaggi, note che alleghi, memoria, riassunti e nomi dei documenti.");
    expect(catalog.account.optionalHint).toMatch(catalog === en ? /local-mode/i : /modalità locale/i);
    expect(catalog.memory.note).toMatch(catalog === en ? /computer mode.*included with the conversation/i : /modalità computer.*inclusa nella conversazione/i);
    expect(catalog.settings.telemetryBodyOn).not.toMatch(catalog === en ? /chats.*never leave this device/i : /chat.*non lasciano mai questo dispositivo/i);

    for (const prompt of [catalog.systemPrompt, catalog.systemPromptWithSearch]) {
      expect(prompt).toContain(catalog === en ? "No cloud, no account, no tracking." : "Nessun cloud, nessun account, nessun tracciamento.");
      expect(prompt).not.toMatch(/running entirely on this device|gira interamente su questo dispositivo|small on-device model|modello piccolo sul dispositivo/i);
    }

    expect(catalog.help.privacy.body).toMatch(catalog === en ? /telemetry is off by default/i : /telemetria è disattivata di default/i);
    expect(catalog.help.privacy.body).toMatch(catalog === en ? /do not include chat text, documents or API keys/i : /non includono testo delle chat, documenti o chiavi API/i);
  });

  it("leaves the truthful dictation-on-device sentence unchanged in both locales", () => {
    expect(italian.help.privacy.voice).toBe("Il microfono serve solo per la dettatura. L'audio è trascritto interamente sul dispositivo: non viene mai inviato, condiviso o conservato dopo la trascrizione.");
    expect(en.help.privacy.voice).toBe("The microphone is used only for dictation. Speech is transcribed entirely on this device — audio is never uploaded, shared, or stored after transcription.");
  });
});
