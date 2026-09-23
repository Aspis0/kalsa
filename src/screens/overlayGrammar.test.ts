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
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en" }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
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
const expand = [AccountSignInPanel, DocumentsEmptyState, NoteEditorSheet, PersonaEditorSheet, PersonaRow];

function resetHooks(values: unknown[] = []) {
  mockHookValues = values;
  mockHookCursor = 0;
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  const nested = typeof element.type === "function" && expand.includes(element.type as any)
    ? (element.type as (props: any) => React.ReactNode)(element.props)
    : element.props.children;
  return [element, ...elements(nested)];
}

function primaryButtons(tree: unknown): Element[] {
  return elements(tree).filter((element) => {
    if (element.type !== "Pressable" || typeof element.props.style !== "function") return false;
    return element.props.style({ pressed: false }).backgroundColor === modes.light.brand;
  });
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
    resetHooks(["none", "reader@example.test"]);
    const account = AccountScreen({ onBack: jest.fn(), onOpenPro: jest.fn() });
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
    const personas = PersonasScreen({ onBack: jest.fn() });

    expect({
      account: primaryButtons(account).length,
      pro: primaryButtons(pro).length,
      help: primaryButtons(help).length,
      documents: primaryButtons(documents).length,
      documentsWithRows: primaryButtons(documentsWithRows).length,
      notes: primaryButtons(notes).length,
      personas: primaryButtons(personas).length,
    }).toEqual({ account: 1, pro: 1, help: 0, documents: 1, documentsWithRows: 1, notes: 1, personas: 1 });
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
    const noteSheet = elements(expandSheet(NoteEditorSheet(noteEditor!.props as any) as Element));
    const noteModal = noteSheet.find((node) => node.type === "Modal");
    expect(elements(noteModal).filter((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel)).toEqual(["notes.edit"]);
    const noteList = elements(noteTree).find((node) => node.type === "ScrollView");
    expect(elements(noteList).filter((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel)).toEqual(["notes.search"]);

    const persona = { id: "user-2", name: "Writer", instructions: "Write", builtin: false };
    mockListPersonas.mockReturnValue([persona]);
    resetHooks([{ items: [], hiddenBuiltinIds: [] }, "", null, ""]);
    let personaTree = PersonasScreen({ onBack: jest.fn() });
    const editAction = elements(personaTree).find((node) => node.props.testID === "personas.action.edit.user-2");
    const actionTree = (editAction!.type as (props: any) => React.ReactNode)(editAction!.props);
    elements(actionTree).find((node) => node.type === "Pressable")?.props.onPress();
    resetHooks(mockHookValues);
    personaTree = PersonasScreen({ onBack: jest.fn() });
    const personaEditor = elements(personaTree).find((node) => node.type === PersonaEditorSheet);
    expect(personaEditor).toBeDefined();
    const personaSheet = elements(expandSheet(PersonaEditorSheet(personaEditor!.props as any) as Element));
    const personaModal = personaSheet.find((node) => node.type === "Modal");
    expect(elements(personaModal).filter((node) => node.type === "TextInput")).toHaveLength(2);
    const personaList = elements(personaTree).find((node) => node.type === "ScrollView");
    expect(elements(personaList).filter((node) => node.type === "TextInput")).toHaveLength(0);
  });
});
