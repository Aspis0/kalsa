import React from "react";

import { modes } from "../theme/design";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { PERSONA_INSTRUCTIONS_CAP } from "../conversations/PersonasStore";
import { AccountSignInPanel } from "./AccountSignInPanel";
import { DocumentListItem } from "./documents/DocumentListItem";
import { NoteEditorSheet } from "./NoteEditorSheet";
import { PersonaEditorSheet } from "./PersonaEditorSheet";
import { PersonaRow } from "./PersonaRow";

let mockHookValues: unknown[] = [];
let mockHookCursor = 0;

jest.mock("react-native", () => ({
  Image: "Image",
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

jest.mock("lucide-react-native", () => ({
  Apple: "Apple",
  BookOpen: "BookOpen",
  Camera: "Camera",
  EllipsisVertical: "EllipsisVertical",
  FileText: "FileText",
  GripVertical: "GripVertical",
  Image: "Image",
  Search: "Search",
  Share2: "Share2",
  Sparkles: "Sparkles",
  StickyNote: "StickyNote",
  Trash2: "Trash2",
  UserCircle: "UserCircle",
  X: "X",
}));
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: (initial: unknown) => {
    const index = mockHookCursor++;
    if (!Object.prototype.hasOwnProperty.call(mockHookValues, index)) mockHookValues[index] = initial;
    return [mockHookValues[index], (value: unknown) => { mockHookValues[index] = value; }];
  },
}));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en" }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../documents/DocumentLibrary", () => ({
  formatBytesLocalized: (bytes: number) => `${bytes} bytes`,
}));

const colors = modes.light;
const t = (key: string) => key;
type Element = React.ReactElement<Record<string, any>>;

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function invokePressable(element: Element) {
  expect(element.type).toBe("Pressable");
  element.props.onPress();
}

function resetHooks(values: unknown[] = []) {
  mockHookValues = values;
  mockHookCursor = 0;
}

function attachSheetTree(sheet: Element): unknown {
  expect(sheet.type).toBe(AttachSheet);
  return AttachSheet(sheet.props as any);
}

describe("overlay leaf modules", () => {
  it("renders one enabled email primary and forwards editing and continue actions", () => {
    const onDraftChange = jest.fn();
    const onContinue = jest.fn();
    const tree = AccountSignInPanel({
      colors,
      source: "none",
      t,
      draft: "reader@example.test",
      busy: false,
      error: null,
      socialNotice: null,
      inputBorder: colors.line,
      onDraftChange,
      onContinue,
      onSocialPress: jest.fn(),
    });
    const nodes = elements(tree);
    const primary = nodes.filter((node) =>
      node.type === "Pressable" && node.props.accessibilityLabel === "common.continue",
    );
    const input = nodes.find((node) => node.type === "TextInput");

    expect(primary).toHaveLength(1);
    expect(primary[0]?.props.disabled).toBe(false);
    input?.props.onChangeText("new@example.test");
    invokePressable(primary[0]!);
    expect(onDraftChange).toHaveBeenCalledWith("new@example.test");
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("puts note fields and row actions inside AttachSheet and dispatches them", () => {
    const onSave = jest.fn();
    const onExport = jest.fn();
    const onDelete = jest.fn();
    const onDraftChange = jest.fn();
    const wrapper = NoteEditorSheet({
      title: "Meeting notes",
      draft: "Agenda",
      notice: "",
      hasSavedNote: true,
      colors,
      t,
      onDraftChange,
      onSave,
      onExport,
      onDelete,
      onClose: jest.fn(),
    }) as Element;
    const tree = attachSheetTree(wrapper);
    const nodes = elements(tree);
    const modal = nodes.find((node) => node.type === "Modal");
    const save = nodes.find((node) => node.props.testID === "shell.attach.primary");
    const exportButton = nodes.find((node) => node.props.accessibilityLabel === "notes.export");
    const deleteButton = nodes.find((node) => node.props.accessibilityLabel === "notes.delete");
    const input = nodes.find((node) => node.props.accessibilityLabel === "notes.edit");

    expect(wrapper.props.title).toBe("Meeting notes");
    expect(elements(modal).some((node) => node.type === "TextInput")).toBe(true);
    input?.props.onChangeText("Updated agenda");
    invokePressable(save!);
    invokePressable(exportButton!);
    invokePressable(deleteButton!);
    expect(onDraftChange).toHaveBeenCalledWith("Updated agenda");
    expect([onSave, onExport, onDelete].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("keeps persona editor fields in the shared sheet, caps instructions, and saves", () => {
    const onChange = jest.fn();
    const onSave = jest.fn();
    const editor = { id: "p-1", name: "Writer", instructions: "Short" };
    const wrapper = PersonaEditorSheet({
      editor,
      notice: "",
      colors,
      t,
      onChange,
      onSave,
      onClose: jest.fn(),
    }) as Element;
    const nodes = elements(attachSheetTree(wrapper));
    const modal = nodes.find((node) => node.type === "Modal");
    const inputs = elements(modal).filter((node) => node.type === "TextInput");
    const save = nodes.find((node) => node.props.testID === "shell.attach.primary");

    expect(wrapper.props.title).toBe("personas.edit");
    expect(inputs).toHaveLength(2);
    inputs[0]?.props.onChangeText("Editor");
    inputs[1]?.props.onChangeText("Longer instructions");
    const overlong = "x".repeat(PERSONA_INSTRUCTIONS_CAP + 1);
    inputs[1]?.props.onChangeText(overlong);
    invokePressable(save!);
    expect(onChange).toHaveBeenNthCalledWith(1, { ...editor, name: "Editor" });
    expect(onChange).toHaveBeenNthCalledWith(2, { ...editor, instructions: "Longer instructions" });
    expect(onChange).toHaveBeenNthCalledWith(3, {
      ...editor,
      instructions: overlong.slice(0, PERSONA_INSTRUCTIONS_CAP),
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps only Use on a persona row and routes custom actions through its sheet", () => {
    const onActivate = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const onToggleHidden = jest.fn();
    const props = {
      persona: { id: "user-7", name: "Writer", instructions: "Write", builtin: false } as any,
      active: false,
      hidden: false,
      colors,
      t,
      onActivate,
      onEdit,
      onDelete,
      onToggleHidden,
    };
    resetHooks();
    const tree = PersonaRow(props);
    const nodes = elements(tree);
    expect(nodes.filter((node) => node.props.testID?.startsWith("personas.action.")).map((node) => node.props.testID)).toEqual([
      "personas.action.use.user-7",
    ]);
    expect(nodes.find((node) => node.props.style?.minHeight === 56)?.props.style.minHeight).toBe(56);
    expect(nodes.find((node) => node.type === "Text" && node.props.children?.includes("Writer"))?.props.style[1])
      .toMatchObject({ flex: 1, minWidth: 0 });
    const use = nodes.find((node) => node.props.testID === "personas.action.use.user-7")!;
    invokePressable((use.type as (props: any) => React.ReactNode)(use.props) as Element);
    const more = nodes.find((node) => node.props.testID === "personas.actions.user-7")!;
    invokePressable(more);

    resetHooks(mockHookValues);
    const openTree = elements(PersonaRow(props));
    const sheet = openTree.find((node) => node.type === AttachSheet)!;
    expect(sheet.props.title).toBe("personas.rowActions");
    const sheetNodes = elements(attachSheetTree(sheet));
    for (const testID of ["personas.action.edit.user-7", "personas.action.delete.user-7"]) {
      const row = sheetNodes.find((node) => typeof node.type === "function" && node.type.name === "SheetRow" && node.props.row.testID === testID)!;
      invokePressable((row.type as (props: any) => React.ReactNode)(row.props) as Element);
    }

    expect([onActivate, onEdit, onDelete].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
    expect(onToggleHidden).not.toHaveBeenCalled();
  });

  it("offers builtin Duplicate and Hide or Show actions in the selected persona sheet", () => {
    const onEdit = jest.fn();
    const onToggleHidden = jest.fn();
    const props = {
      persona: { id: "builtin-coder", name: "Coder", instructions: "Code", builtin: true } as any,
      active: false,
      hidden: false,
      colors,
      t,
      onActivate: jest.fn(),
      onEdit,
      onDelete: jest.fn(),
      onToggleHidden,
    };
    resetHooks();
    const row = elements(PersonaRow(props)).find((node) => node.props.testID === "personas.actions.builtin-coder")!;
    invokePressable(row);
    resetHooks(mockHookValues);
    const sheet = elements(PersonaRow(props)).find((node) => node.type === AttachSheet)!;
    expect(sheet.props.rows.map((item: { label: string }) => item.label)).toEqual([
      "personas.duplicate",
      "personas.hide",
    ]);
    const sheetNodes = elements(attachSheetTree(sheet));
    for (const testID of ["personas.action.duplicate.builtin-coder", "personas.action.visibility.builtin-coder"]) {
      const row = sheetNodes.find((node) => typeof node.type === "function" && node.type.name === "SheetRow" && node.props.row.testID === testID)!;
      invokePressable((row.type as (props: any) => React.ReactNode)(row.props) as Element);
    }
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onToggleHidden).toHaveBeenCalledWith("builtin-coder");
  });

  it("opens the document represented by the pressed library row", () => {
    const doc = { id: "doc-2", name: "Manual.txt", kind: "txt", sizeBytes: 16, docCount: 1 } as any;
    const onOpen = jest.fn();
    const tree = DocumentListItem({ doc, onOpen });
    const row = elements(tree).find((node) => node.type === "Pressable");

    expect(row?.props.accessibilityRole).toBe("button");
    row?.props.onPress();
    expect(onOpen).toHaveBeenCalledWith(doc);
  });
});
