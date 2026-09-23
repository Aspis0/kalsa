import React from "react";

import { modes } from "../theme/design";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { PERSONA_INSTRUCTIONS_CAP } from "../conversations/PersonasStore";
import { AccountSignInPanel } from "./AccountSignInPanel";
import { DocumentListItem } from "./documents/DocumentListItem";
import { NoteEditorSheet } from "./NoteEditorSheet";
import { PersonaEditorSheet } from "./PersonaEditorSheet";
import { PersonaRow } from "./PersonaRow";

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
  useState: (initial: unknown) => [initial, jest.fn()],
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

  it("routes persona row controls to the selected row's actions", () => {
    const onActivate = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const tree = PersonaRow({
      persona: { id: "user-7", name: "Writer", instructions: "Write", builtin: false } as any,
      active: false,
      hidden: false,
      colors,
      t,
      onActivate,
      onEdit,
      onDelete,
      onToggleHidden: jest.fn(),
    });
    const actions = elements(tree).filter((node) =>
      typeof node.type === "function" && node.type.name === "Action",
    );
    for (const testID of [
      "personas.action.use.user-7",
      "personas.action.edit.user-7",
      "personas.action.delete.user-7",
    ]) {
      const action = actions.find((node) => node.props.testID === testID)!;
      const actionTree = (action.type as (props: any) => React.ReactNode)(action.props);
      invokePressable(actionTree as Element);
    }

    expect([onActivate, onEdit, onDelete].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
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
