import React from "react";

import { modes } from "../theme/design";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { AccountScreen } from "./AccountScreen";
import { AccountSignInPanel } from "./AccountSignInPanel";
import { DocumentsScreen } from "./DocumentsScreen";
import { DocumentsEmptyState } from "./documents/DocumentsEmptyState";
import { HelpScreen } from "./HelpScreen";
import { NoteEditorSheet } from "./NoteEditorSheet";
import { NotesScreen } from "./NotesScreen";
import { PersonaEditorSheet } from "./PersonaEditorSheet";
import { PersonasScreen } from "./PersonasScreen";
import { PersonaRow } from "./PersonaRow";
import { ProScreen } from "./ProScreen";
import { SettingsHomeScreen } from "./SettingsHomeScreen";

let mockHookValues: unknown[] = [];
let mockHookCursor = 0;
const mockUseAccount = jest.fn();
const mockUseDocumentImport = jest.fn();
const mockReadNote = jest.fn();
const mockListPersonas = jest.fn();

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => {
      const index = mockHookCursor++;
      if (!Object.prototype.hasOwnProperty.call(mockHookValues, index)) mockHookValues[index] = initial;
      return [mockHookValues[index], (value: unknown) => {
        mockHookValues[index] = typeof value === "function"
          ? (value as (previous: unknown) => unknown)(mockHookValues[index])
          : value;
      }];
    },
  };
});

jest.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: jest.fn() },
  BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Share: { share: jest.fn().mockResolvedValue(undefined) },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
jest.mock("../../assets/icon.png", () => "brand-mark");
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en", setLocale: jest.fn() }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light", setMode: jest.fn(), fontScaleId: "m", setFontScaleId: jest.fn() }) }));
jest.mock("./SettingsHeader", () => ({ SettingsHeader: "SettingsHeader" }));
jest.mock("../account/useAccount", () => ({
  InvalidEmailError: class InvalidEmailError extends Error {},
  useAccount: () => mockUseAccount(),
}));
jest.mock("../account/storeSource", () => ({ detectStoreSource: jest.fn() }));
jest.mock("../documents/documentChatTool", () => ({ isDocumentOpInFlight: () => false }));
jest.mock("../documents/documentStorage", () => ({}));
jest.mock("./documents/useDocumentImport", () => ({ useDocumentImport: (...args: unknown[]) => mockUseDocumentImport(...args) }));
jest.mock("./documents/DocumentDetailView", () => ({ DocumentDetailView: "DocumentDetailView" }));
jest.mock("./documents/DocumentListItem", () => ({ DocumentListItem: "DocumentListItem" }));
jest.mock("./documents/DocumentImportOverlay", () => ({ DocumentImportOverlay: "DocumentImportOverlay" }));
jest.mock("../notes/NotesStore", () => ({
  deleteNote: jest.fn(),
  filterNotes: (items: unknown[]) => items,
  loadNotesIndex: jest.fn().mockResolvedValue([]),
  readNote: (...args: unknown[]) => mockReadNote(...args),
  saveNote: jest.fn(),
}));
jest.mock("../conversations/PersonasStore", () => ({
  PERSONA_INSTRUCTIONS_CAP: 4000,
  findPersona: jest.fn(),
  getDefaultPersonasStorage: jest.fn(),
  isBuiltinPersonaId: (id: string) => id.startsWith("builtin-"),
  listAllPersonas: (...args: unknown[]) => mockListPersonas(...args),
  loadPersonasState: jest.fn(),
  nextPersonaId: () => "persona-new",
  removeUserPersona: jest.fn(),
  sanitizePersonaInstructions: (value: string) => value.trim(),
  sanitizePersonaName: (value: string) => value.trim(),
  saveActivePersonaId: jest.fn(),
  savePersonasState: jest.fn(),
  setBuiltinHidden: jest.fn(),
  upsertUserPersona: jest.fn(),
}));
jest.mock("react-native-draggable-flatlist", () => ({
  __esModule: true,
  default: "DraggableFlatList",
  ScaleDecorator: "ScaleDecorator",
}));

type Element = React.ReactElement<Record<string, any>>;
const expand = [AccountSignInPanel, AttachSheet, DocumentsEmptyState, NoteEditorSheet, PersonaEditorSheet, PersonaRow];
const expandByName = new Set(["Action", "Group", "Row", "SheetRow"]);

function resetHooks(values: unknown[] = []) {
  mockHookValues = values;
  mockHookCursor = 0;
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  const componentName = typeof element.type === "function" ? element.type.name : "";
  const nested = typeof element.type === "function" && (
    expand.includes(element.type as any) || expandByName.has(componentName)
  )
    ? (element.type as (props: any) => React.ReactNode)(element.props)
    : element.props.children;
  return [element, ...elements(nested)];
}

function styleObjects(style: unknown, pressed: boolean): Array<Record<string, unknown>> {
  const resolved = typeof style === "function" ? (style as (state: { pressed: boolean }) => unknown)({ pressed }) : style;
  if (Array.isArray(resolved)) return resolved.flatMap((entry) => styleObjects(entry, pressed));
  return resolved && typeof resolved === "object" ? [resolved as Record<string, unknown>] : [];
}

function filledBrandActions(tree: unknown): Element[] {
  return elements(tree).filter((element) => {
    const { accessibilityRole, accessibilityState, disabled, onPress, style } = element.props;
    const actionable = typeof onPress === "function" || accessibilityRole === "button" || accessibilityRole === "switch";
    if (!actionable || disabled || accessibilityState?.disabled) return false;
    return [false, true].some((pressed) => styleObjects(style, pressed).some((candidate) =>
      candidate.backgroundColor === modes.light.brand || candidate.backgroundColor === modes.light.brandDeep,
    ));
  });
}

function invokePressable(element: Element) {
  expect(element.type).toBe("Pressable");
  element.props.onPress();
}

function expandSheet(sheet: Element) {
  expect(sheet.type).toBe(AttachSheet);
  return AttachSheet(sheet.props as any);
}

beforeEach(() => {
  resetHooks();
  mockUseAccount.mockReset().mockReturnValue({
    email: null,
    isSignedIn: false,
    loading: false,
    signIn: jest.fn().mockResolvedValue(undefined),
    signOut: jest.fn().mockResolvedValue(undefined),
  });
  mockUseDocumentImport.mockReset().mockReturnValue({
    importing: false,
    importName: null,
    importDocument: jest.fn(),
    busyGuards: () => false,
  });
  mockReadNote.mockReset().mockResolvedValue({ id: "note-1", title: "Existing note", body: "Text", updatedAt: 1 });
  mockListPersonas.mockReset().mockReturnValue([]);
});

describe("six-overlay action and editing grammar", () => {
  it("shows one brand primary on each action surface; Help remains informational", () => {
    resetHooks(["none", ""]);
    const accountLanding = AccountScreen({ onBack: jest.fn(), onOpenPro: jest.fn() });
    const disabledContinue = elements(accountLanding).find((node) => node.props.accessibilityLabel === "common.continue");
    expect(disabledContinue?.props.disabled).toBe(true);
    expect(disabledContinue?.props.accessibilityState.disabled).toBe(true);
    expect(styleObjects(disabledContinue?.props.style, false).map((style) => style.backgroundColor)).toContain(modes.light.tint);
    expect(filledBrandActions(accountLanding)).toHaveLength(0);

    resetHooks(["none", "reader@example.test"]);
    const accountWithDraft = AccountScreen({ onBack: jest.fn(), onOpenPro: jest.fn() });
    const enabledContinue = elements(accountWithDraft).find((node) => node.props.accessibilityLabel === "common.continue");
    expect(enabledContinue?.props.disabled).toBe(false);
    expect(filledBrandActions(accountWithDraft)).toHaveLength(1);

    mockUseAccount.mockReturnValue({
      email: "reader@example.test",
      isSignedIn: true,
      loading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    resetHooks(["none"]);
    const signedInAccount = AccountScreen({ onBack: jest.fn(), onOpenPro: jest.fn() });
    expect(elements(signedInAccount).some((node) => node.props.accessibilityLabel === "account.upgradeToPro")).toBe(true);
    expect(filledBrandActions(signedInAccount)).toHaveLength(0);

    resetHooks();
    const pro = ProScreen({ onBack: jest.fn() });
    resetHooks();
    const help = HelpScreen({ onBack: jest.fn() });
    resetHooks();
    const documents = DocumentsScreen({
      library: { docs: [] } as any,
      onAddDocument: () => true,
      onDeleteDocument: async () => true,
      onRebuildSemanticIndex: async () => true,
      isSemanticRebuildBusy: false,
      onReorderDocuments: jest.fn(),
      onUpdateDocumentPreview: jest.fn(),
      isDocumentDeleteInFlight: () => false,
      onBack: jest.fn(),
    });
    resetHooks();
    const documentsWithRows = DocumentsScreen({
      library: { docs: [{ id: "doc-1", name: "Guide.pdf", kind: "pdf" }] } as any,
      onAddDocument: () => true,
      onDeleteDocument: async () => true,
      onRebuildSemanticIndex: async () => true,
      isSemanticRebuildBusy: false,
      onReorderDocuments: jest.fn(),
      onUpdateDocumentPreview: jest.fn(),
      isDocumentDeleteInFlight: () => false,
      onBack: jest.fn(),
    });
    resetHooks();
    const notes = NotesScreen({ onBack: jest.fn() });
    resetHooks();
    mockListPersonas.mockReturnValue([
      { id: "user-count", name: "Writer", instructions: "Write", builtin: false },
    ]);
    const personas = PersonasScreen({ onBack: jest.fn() });

    expect({
      pro: filledBrandActions(pro).length,
      help: filledBrandActions(help).length,
      documents: filledBrandActions(documents).length,
      documentsWithRows: filledBrandActions(documentsWithRows).length,
      notes: filledBrandActions(notes).length,
      personasWithRow: filledBrandActions(personas).length,
    }).toEqual({ pro: 0, help: 0, documents: 1, documentsWithRows: 1, notes: 1, personasWithRow: 1 });
  });

  it("renders the six Help sections in the copy document's order", () => {
    const help = HelpScreen({ onBack: jest.fn() });
    const labels = elements(help)
      .filter((node) => node.type === "Text")
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === "string");
    expect(labels).toEqual([
      "help.about.title", "help.about.body",
      "help.modelLocation.title", "help.modelLocation.body",
      "help.deviceData.title", "help.deviceData.body",
      "help.computer.title", "help.computer.body",
      "help.models.title", "help.models.body",
      "help.privacy.title", "help.privacy.body", "help.privacy.voice",
    ]);
  });

  it("routes the Kalsa Help and Pro rows to their supplied destinations", () => {
    const onOpenHelp = jest.fn();
    const onOpenPro = jest.fn();
    const homeProps = {
      onBack: jest.fn(),
      onOpenAdvanced: jest.fn(),
      modelOptions: [],
      currentModelId: "",
      remoteActive: false,
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
    };
    resetHooks();
    const tree = SettingsHomeScreen({ ...homeProps, onOpenHelp, onOpenPro });
    const kalsaOrder = elements(tree)
      .filter((node) =>
        (node.type === "View" && node.props.testID === "settings.home.kalsa") ||
        (node.type === "Pressable" && ["settings.home.help", "settings.home.pro"].includes(node.props.testID)),
      )
      .map((node) => node.props.testID);
    expect(kalsaOrder).toEqual(["settings.home.kalsa", "settings.home.help", "settings.home.pro"]);
    const help = elements(tree).find((node) => node.type === "Pressable" && node.props.testID === "settings.home.help");
    const pro = elements(tree).find((node) => node.type === "Pressable" && node.props.testID === "settings.home.pro");

    invokePressable(help!);
    invokePressable(pro!);

    expect([onOpenHelp, onOpenPro].map((callback) => callback.mock.calls.length)).toEqual([1, 1]);

    resetHooks();
    const legacyTree = elements(SettingsHomeScreen({ ...homeProps, onOpenHelp }));
    expect(legacyTree.some((node) => node.props.testID === "settings.home.pro")).toBe(false);
  });

  it("opens existing note and persona editors in AttachSheet, outside their lists", async () => {
    const note = { id: "note-1", title: "Existing note", body: "Text", updatedAt: 1 };
    resetHooks([[{ id: note.id, title: note.title, updatedAt: note.updatedAt }], "", null, "", ""]);
    let noteTree = NotesScreen({ onBack: jest.fn() });
    const noteRow = elements(noteTree).find((node) => node.props.accessibilityLabel === note.title);
    noteRow?.props.onPress();
    await Promise.resolve();
    resetHooks(mockHookValues);
    noteTree = NotesScreen({ onBack: jest.fn() });
    const noteEditor = elements(noteTree).find((node) => node.type === NoteEditorSheet);
    expect(noteEditor).toBeDefined();
    const noteSheetTree = expandSheet(NoteEditorSheet(noteEditor!.props as any) as Element);
    const noteSheet = elements(noteSheetTree);
    const noteModal = noteSheet.find((node) => node.type === "Modal");
    expect(elements(noteModal).filter((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel)).toEqual(["notes.edit"]);
    expect(filledBrandActions(noteSheetTree)).toHaveLength(1);
    const noteList = elements(noteTree).find((node) => node.type === "ScrollView");
    expect(elements(noteList).filter((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel)).toEqual(["notes.search"]);

    mockListPersonas.mockReturnValue([{ id: "user-2", name: "Writer", instructions: "Write", builtin: false }]);
    resetHooks([{ items: [], hiddenBuiltinIds: [] }, "", null, ""]);
    let personaTree = PersonasScreen({ onBack: jest.fn() });
    elements(personaTree).find((node) => node.props.testID === "personas.actions.user-2")!.props.onPress();
    resetHooks(mockHookValues);
    personaTree = PersonasScreen({ onBack: jest.fn() });
    elements(personaTree).find((node) => node.type === AttachSheet)!.props.rows
      .find((row: { testID: string }) => row.testID === "personas.action.edit.user-2").onPress();
    resetHooks(mockHookValues);
    personaTree = PersonasScreen({ onBack: jest.fn() });
    const personaEditor = elements(personaTree).find((node) => node.type === PersonaEditorSheet);
    expect(personaEditor).toBeDefined();
    const personaSheetTree = expandSheet(PersonaEditorSheet(personaEditor!.props as any) as Element);
    const personaSheet = elements(personaSheetTree);
    expect(elements(personaSheet.find((node) => node.type === "Modal")).filter((node) => node.type === "TextInput")).toHaveLength(2);
    expect(filledBrandActions(personaSheetTree)).toHaveLength(1);
    expect(elements(elements(personaTree).find((node) => node.type === "ScrollView")).filter((node) => node.type === "TextInput")).toHaveLength(0);
  });
});
