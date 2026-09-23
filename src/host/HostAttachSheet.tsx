/**
 * The host's attach sheet: the controller's TWO modals — the three-answer
 * action list (`AiChatPage.tsx:4584-4620`) and the nested library-document
 * picker (`:4627-4663`) — as row data over the shell's drawn `AttachSheet`.
 * The entry points and their catalogue keys are listed here in one place, so
 * this file reads as the flow's menu.
 *
 * The menu also owns the composer actions removed from the permanent toolbar:
 * templates, research and notes. Research and notes are switches, so they can
 * be checked and changed without dismissing the sheet.
 */
import { useLocale, type TranslationKey } from "../i18n";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { DesignColors } from "../theme/design";
import {
  AttachSheet,
  type AttachSheetIcon,
  type AttachSheetRowData,
} from "../ui/shell/AttachSheet";

export type AttachAction = "library" | "camera" | "document" | "libraryDocument" | "templates" | "research" | "notes";

export interface HostAttachSheetProps {
  /** Which sheet is up: the actions, the library list, or neither. */
  open: "actions" | "documents" | null;
  colors: DesignColors;
  /** The library the document list draws (empty list = cancel only). */
  docs: readonly LibraryDoc[];
  /** Composer arms and entries available from the composer attach control. */
  researchActive: boolean;
  notesActive: boolean;
  actionsDisabled: boolean;
  onAction: (action: AttachAction) => void;
  onDocumentPick: (doc: { id: string; name: string }) => void;
  onClose: () => void;
}

const ACTIONS: ReadonlyArray<{
  action: AttachAction;
  testID: string;
  icon: AttachSheetIcon;
  labelKey: TranslationKey;
  role?: "button" | "switch";
}> = [
  {
    action: "library",
    testID: "shell.attach.library",
    icon: "library",
    labelKey: "chat.photoLibrary",
  },
  { action: "camera", testID: "shell.attach.camera", icon: "camera", labelKey: "chat.takePhoto" },
  {
    action: "document",
    testID: "shell.attach.pdfOrWord",
    icon: "file",
    labelKey: "chat.pdfOrWord",
  },
  {
    action: "libraryDocument",
    testID: "shell.attach.libraryDocument",
    icon: "book",
    labelKey: "chat.libraryDocument",
  },
  { action: "templates", testID: "shell.attach.templates", icon: "templates", labelKey: "chat.a11yTemplates" },
  { action: "research", testID: "shell.attach.research", icon: "research", labelKey: "chat.deepResearch", role: "switch" },
  { action: "notes", testID: "shell.attach.notes", icon: "notes", labelKey: "notes.title", role: "switch" },
];

export function HostAttachSheet(props: HostAttachSheetProps) {
  const { t } = useLocale();
  const { open, colors, docs } = props;
  if (open === null) return null;
  const rows: AttachSheetRowData[] =
    open === "actions"
      ? ACTIONS.map((row) => ({
          testID: row.testID,
          icon: row.icon,
          label: t(row.labelKey),
          role: row.role,
          selected: row.action === "research" ? props.researchActive : row.action === "notes" ? props.notesActive : undefined,
          disabled: props.actionsDisabled,
          onPress: () => props.onAction(row.action),
        }))
      : [
          // The controller's document rows: the doc NAME is the label (data,
          // not a catalogue string) and Cancel closes the nested picker.
          ...docs.map((doc) => ({
            testID: `shell.attach.doc.${doc.id}`,
            icon: "file" as const,
            label: doc.name,
            onPress: () => props.onDocumentPick({ id: doc.id, name: doc.name }),
          })),
          {
            testID: "shell.attach.cancel",
            icon: "close" as const,
            label: t("common.cancel"),
            onPress: props.onClose,
          },
        ];
  return (
    <AttachSheet
      rows={rows}
      colors={colors}
      onClose={props.onClose}
      scroll={open === "documents"}
    />
  );
}
