import React from "react";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
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

function homeElements(catalog: Catalog, modelId: string): Element[] {
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
    remoteActive: modelId === REMOTE_COMPUTER_MODEL_ID,
    modelBusy: false,
    onSelectModel: jest.fn(),
    onSelectLocation: jest.fn(() => true),
    telemetryEnabled: false,
    telemetryBusy: false,
    onToggleTelemetry: jest.fn(),
    deviceToolsEnabled: false,
    onToggleDeviceTools: jest.fn(),
    calendarToolsEnabled: false,
    onToggleCalendarTools: jest.fn(),
    appVersion: "1.0",
  });
  return elements(tree);
}

function homeText(catalog: Catalog, modelId: string) {
  return homeElements(catalog, modelId)
    .filter((node) => node.type === "Text")
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === "string");
}

const HELP_SECTIONS = ["about", "modelLocation", "deviceData", "computer", "models", "privacy"] as const;

type CatalogLocale = "en" | "it";
type UniversalClaimAllowance = {
  locale: CatalogLocale;
  key: string;
  phrase: string;
  source: string;
  reason: string;
};

// These are the deliberate cross-mode exceptions. Each phrase is pinned to a
// catalog key and source line so a later copy edit cannot silently broaden it.
const UNIVERSAL_CLAIM_ALLOWLIST: readonly UniversalClaimAllowance[] = [
  { locale: "en", key: "help.privacy.voice", phrase: "The microphone is used only for dictation. Speech is transcribed entirely on this device — audio is never uploaded, shared, or stored after transcription.", source: "src/i18n/en.ts:430", reason: "Dictation is always transcribed on the phone; audio is not sent." },
  { locale: "it", key: "help.privacy.voice", phrase: "Il microfono serve solo per la dettatura. L'audio è trascritto interamente sul dispositivo: non viene mai inviato, condiviso o conservato dopo la trascrizione.", source: "src/i18n/it.ts:425", reason: "La dettatura viene sempre trascritta sul telefono; l'audio non viene inviato." },
  { locale: "en", key: "voice.hint", phrase: "On-device speech recognition and read-aloud. Audio never leaves this device.", source: "src/i18n/en.ts:342", reason: "Speech recognition and read-aloud keep audio on the phone in every mode." },
  { locale: "it", key: "voice.hint", phrase: "Riconoscimento vocale e lettura ad alta voce sul dispositivo. L'audio non esce mai dal telefono.", source: "src/i18n/it.ts:337", reason: "Riconoscimento vocale e lettura ad alta voce tengono l'audio sul telefono in ogni modalità." },
  { locale: "en", key: "help.deviceData.body", phrase: "Your document files stay on this phone. In computer mode, their names can be included with the conversation, but the files themselves are not sent.", source: "src/i18n/en.ts:413", reason: "The document files stay on the phone; only their names may travel." },
  { locale: "it", key: "help.deviceData.body", phrase: "I file dei documenti restano su questo telefono. In modalità computer, i loro nomi possono essere inclusi nella conversazione, ma i file non vengono inviati.", source: "src/i18n/it.ts:408", reason: "I file dei documenti restano sul telefono; possono viaggiare solo i loro nomi." },
  { locale: "en", key: "drawer.subtitle", phrase: "Private · local by default", source: "src/i18n/en.ts:38", reason: "Local execution is the default; computer mode is an explicit choice." },
  { locale: "it", key: "drawer.subtitle", phrase: "Privata · locale di default", source: "src/i18n/it.ts:37", reason: "L'esecuzione locale è predefinita; la modalità computer è una scelta esplicita." },
  { locale: "en", key: "settings.brandVersion", phrase: "Version {version} · private · local by default", source: "src/i18n/en.ts:84", reason: "This names the default, not every possible model location." },
  { locale: "it", key: "settings.brandVersion", phrase: "Versione {version} · privato · locale di default", source: "src/i18n/it.ts:83", reason: "Descrive il valore predefinito, non ogni possibile posizione del modello." },
  { locale: "en", key: "settings.aboutBody", phrase: "Private assistant, local by default. Chat, web search, and interactive mini-apps — no account required.", source: "src/i18n/en.ts:210", reason: "It explicitly scopes local operation to the default." },
  { locale: "it", key: "settings.aboutBody", phrase: "Assistente privato, locale di default. Chat, ricerca web e mini-app interattive — senza account.", source: "src/i18n/it.ts:209", reason: "La frase limita esplicitamente l'uso locale al valore predefinito." },
  { locale: "en", key: "shell.where.pillLocal", phrase: "Local", source: "src/i18n/en.ts:1317", reason: "This is the location label only for local mode." },
  { locale: "en", key: "shell.where.pillComputer", phrase: "Your computer", source: "src/i18n/en.ts:1318", reason: "This names the other explicit model location." },
  { locale: "it", key: "shell.where.pillLocal", phrase: "Locale", source: "src/i18n/it.ts:1263", reason: "Questa etichetta indica la posizione solo in modalità locale." },
  { locale: "it", key: "shell.where.pillComputer", phrase: "Il tuo computer", source: "src/i18n/it.ts:1264", reason: "Indica l'altra posizione esplicita del modello." },
  { locale: "en", key: "account.proUnchangedBody", phrase: "Chat on this phone stays free and local.", source: "src/i18n/en.ts:1104", reason: "The free local-chat offer remains available; older phones are also stated as supported." },
  { locale: "it", key: "account.proUnchangedBody", phrase: "La chat su questo telefono resta gratuita e locale.", source: "src/i18n/it.ts:1073", reason: "La chat locale gratuita resta disponibile; è dichiarato anche il supporto ai telefoni meno recenti." },
  { locale: "en", key: "systemPrompt", phrase: "No cloud, no account, no tracking.", source: "src/i18n/en.ts:1145", reason: "These are the retained privacy and identity facts, not a model-location claim." },
  { locale: "en", key: "systemPromptWithSearch", phrase: "No cloud, no account, no tracking.", source: "src/i18n/en.ts:1168", reason: "These are the retained privacy and identity facts, not a model-location claim." },
  { locale: "it", key: "systemPrompt", phrase: "Nessun cloud, nessun account, nessun tracciamento.", source: "src/i18n/it.ts:1100", reason: "Sono i fatti conservati su privacy e identità, non una dichiarazione sulla posizione del modello." },
  { locale: "it", key: "systemPromptWithSearch", phrase: "Nessun cloud, nessun account, nessun tracciamento.", source: "src/i18n/it.ts:1122", reason: "Sono i fatti conservati su privacy e identità, non una dichiarazione sulla posizione del modello." },
];

const UNSCOPED_DEVICE_CLAIMS = [
  /\b(?:runs?|running)\s+(?:fully|entirely)\s+(?:on[- ]device|on (?:this|your) (?:phone|device))\b/i,
  /\b(?:private on[- ]device assistant|private assistant running entirely on this device)\b/i,
  /\b(?:everything stays on this (?:phone|device)|tutto resta su questo (?:telefono|dispositivo))\b/i,
  /\b(?:gira|funziona)\s+(?:(?:tutto|interamente)\s+)?(?:su|sul)\s+(?:questo\s+)?(?:dispositivo|telefono)\b/i,
  /\b(?:chats?|the chat|la chat)\b.{0,60}\b(?:stays?|remains|resta|restano)\b.{0,60}\b(?:local|locale)\b/i,
  /\b100\s?%\s?(?:local|locale)\b/i,
];

function sentenceAt(value: string, index: number): string {
  const left = Math.max(value.lastIndexOf(".", index), value.lastIndexOf("!", index), value.lastIndexOf("?", index)) + 1;
  const ends = [value.indexOf(".", index), value.indexOf("!", index), value.indexOf("?", index)].filter((end) => end >= 0);
  const right = ends.length ? Math.min(...ends) : value.length;
  return value.slice(left, right);
}

beforeEach(() => {
  mockStrings = {};
  mockHookValues = [];
  mockHookCursor = 0;
});

describe("copy that remains truthful across local and computer modes", () => {
  it.each([["English", en], ["Italian", italian]] as const)("renders concise settings labels in %s", (_name, catalog) => {
    const nodes = homeElements(catalog, REMOTE_COMPUTER_MODEL_ID);
    const rowText = (testID: string) => {
      const row = nodes.find((node) => node.props.testID === testID);
      expect(row).toBeDefined();
      return elements(row)
        .filter((node) => node.type === "Text")
        .map((node) => node.props.children);
    };

    expect(rowText("settings.home.where")).toEqual([
      catalog.settings.whereRuns,
      catalog.shell.where.pillComputer,
    ]);
    expect(rowText("settings.home.model")).toEqual([
      catalog.settings.modelPicker,
      catalog.settings.remoteModelName,
    ]);
    expect(nodes.filter((node) => node.type === "Text").map((node) => node.props.children))
      .not.toContain(REMOTE_COMPUTER_MODEL_ID);
    expect(catalog.shell.where.pillComputer).toBe(_name === "English" ? "Your computer" : "Il tuo computer");
    expect(catalog.settings.remoteComputer).toBe(catalog.shell.where.pillComputer);
    expect(catalog.settings.remoteSelect).toBe(_name === "English" ? "Use your computer" : "Usa il tuo computer");
  });

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

    expect(catalog.help.computer.body).toMatch(catalog === en ? /when computer mode is available/i : /quando la modalità computer sarà disponibile/i);
    expect(rendered.join(" ")).not.toMatch(/QR|camera|scan(?:ning)?|fotocamera|scansion/i);
    expect(rendered.join(" ")).not.toMatch(/Remote brain|Cervello remoto/i);
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
      catalog.account.proFutureTitle,
      catalog.account.proFutureBenefit,
      catalog.account.proUnchangedTitle,
      catalog.account.proUnchangedBody,
    ]));
    const futureRow = pro.find((node) => node.props.testID === "pro.benefit.future");
    expect(futureRow).toBeDefined();
    const futureRowText = elements(futureRow)
      .filter((node) => node.type === "Text")
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === "string");
    expect(futureRowText).toEqual(catalog === en
      ? ["Exclusive features and more powerful AI", "On the newest phones."]
      : ["Funzioni esclusive e AI più potenti", "Sui telefoni più recenti."]);
    expect(text.indexOf(catalog.account.proFutureTitle)).toBeGreaterThan(text.indexOf(catalog.account.proSearchBenefit));
    expect(text.indexOf(catalog.account.proFutureTitle)).toBeLessThan(text.indexOf(catalog.account.proUnchangedTitle));
    expect(futureRowText.join(" ")).not.toMatch(/\d|\b(?:Qwen|LFM|Gemma|GPT|Llama|Mistral|Phi|DeepSeek)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b|\b(?:abbastanza|sufficientemente|enough|sufficiently)\b/i);
    expect(catalog.account.proUnchangedBody).toMatch(catalog === en
      ? /chat on this phone stays free and local.*older phones remain supported/i
      : /chat su questo telefono resta gratuita e locale.*telefoni meno recenti restano supportati/i);
    expect(pro.filter((node) => node.type === "Pressable")).toHaveLength(0);
    expect(text.join(" ")).not.toMatch(/\$|€|\/month|\/mese|subscribe|abbonati|upgrade to pro|passa a pro/i);
  });

  it.each([["English", en], ["Italian", italian]] as const)("keeps model guidance tied to its rendered row in %s", (_name, catalog) => {
    expect(homeText(catalog, "lfm2.5-2.6b")).toEqual(expect.arrayContaining([
      catalog.settings.modelSmallFast,
      "LFM2.5 2.6B · QAD-Q4_0",
    ]));
    expect(homeText(catalog, "qwen3.5-4b")).toEqual(expect.arrayContaining([
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
    expect(catalog.embedding.hint).toMatch(catalog === en ? /in local mode.*runs fully on-device/i : /in modalità locale.*gira tutto sul dispositivo/i);
  });

  it("scans every catalog string for unscoped device claims with a source-pinned universal allowlist", () => {
    const catalogs: Record<CatalogLocale, Record<string, string>> = {
      en: flatten(en),
      it: flatten(italian),
    };
    const findings: string[] = [];

    for (const allowance of UNIVERSAL_CLAIM_ALLOWLIST) {
      const actual = catalogs[allowance.locale][allowance.key];
      if (!actual?.includes(allowance.phrase)) {
        throw new Error(`${allowance.source} (${allowance.key}): ${allowance.reason}`);
      }
    }

    for (const locale of ["en", "it"] as const) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        for (const pattern of UNSCOPED_DEVICE_CLAIMS) {
          const scanner = new RegExp(pattern.source, "gi");
          for (const match of value.matchAll(scanner)) {
            const sentence = sentenceAt(value, match.index ?? 0);
            const hasLocalModeScope = locale === "en"
              ? /\bin local mode\b/i.test(sentence)
              : /\bin modalità locale\b/i.test(sentence);
            const isAllowlisted = UNIVERSAL_CLAIM_ALLOWLIST.some((allowance) =>
              allowance.locale === locale
              && allowance.key === key
              && allowance.phrase.toLocaleLowerCase().includes(match[0].toLocaleLowerCase()),
            );
            if (!hasLocalModeScope && !isAllowlisted) findings.push(`${locale}:${key}: ${match[0]}`);
          }
        }
      }
    }

    if (findings.length) throw new Error(`Unscoped device-location claims: ${findings.join(", ")}`);
  });

  it("leaves the truthful dictation-on-device sentence unchanged in both locales", () => {
    expect(italian.help.privacy.voice).toBe("Il microfono serve solo per la dettatura. L'audio è trascritto interamente sul dispositivo: non viene mai inviato, condiviso o conservato dopo la trascrizione.");
    expect(en.help.privacy.voice).toBe("The microphone is used only for dictation. Speech is transcribed entirely on this device — audio is never uploaded, shared, or stored after transcription.");
  });
});
