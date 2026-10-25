/** Overlay mounts owned by the chat surface: message, template, edit and attach sheets. */
import { QuickActionSheet } from "../theme/components/QuickActionSheet";
import { EditMessageModal } from "../ui/shell/EditMessageModal";
import { MessageMenu } from "../ui/shell/MessageMenu";
import type { ThemeMode, DesignColors } from "../theme/design";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { MiniappTemplate } from "../domain/miniappTemplates";
import type { useMessageActions } from "./messageActions";
import { HostAttachSheet, type AttachAction, type HostAttachSheetProps } from "./HostAttachSheet";

export type HostChatSurfaceOverlaysProps = {
  bottomInset: number;
  mode: ThemeMode;
  colors: DesignColors;
  actions: ReturnType<typeof useMessageActions>;
  quickSheetVisible: boolean;
  onQuickSheetClose: () => void;
  onChooseTemplate: (template: MiniappTemplate) => void;
  editDraft: string;
  onEditDraftChange: (text: string) => void;
  onEditSubmit: () => void;
  onEditClose: () => void;
  attachSheetOpen: boolean;
  docPickOpen: boolean;
  docs: readonly LibraryDoc[];
  researchActive: boolean;
  notesActive: boolean;
  actionsDisabled: boolean;
  onAttachAction: (action: AttachAction) => void;
  onDocumentPick: HostAttachSheetProps["onDocumentPick"];
  onAttachClose: () => void;
};

export function HostChatSurfaceOverlays(props: HostChatSurfaceOverlaysProps) {
  return (
    <>
      <MessageMenu
        mode={props.mode}
        visible={props.actions.menu !== null}
        caption={props.actions.menu?.caption ?? ""}
        rows={props.actions.menu?.rows ?? []}
        bottomInset={props.bottomInset}
        onRowPress={props.actions.onMenuRow}
        onRequestClose={props.actions.closeMenu}
      />
      <QuickActionSheet
        onlyTemplates
        visible={props.quickSheetVisible}
        onClose={props.onQuickSheetClose}
        onChooseTemplate={props.onChooseTemplate}
      />
      <EditMessageModal
        visible={props.actions.edit !== null}
        mode={props.mode}
        draft={props.editDraft}
        onChange={props.onEditDraftChange}
        onSubmit={props.onEditSubmit}
        onClose={props.onEditClose}
      />
      <HostAttachSheet
        open={props.attachSheetOpen ? "actions" : props.docPickOpen ? "documents" : null}
        colors={props.colors}
        docs={props.docs}
        researchActive={props.researchActive}
        notesActive={props.notesActive}
        actionsDisabled={props.actionsDisabled}
        onAction={props.onAttachAction}
        onDocumentPick={props.onDocumentPick}
        onClose={props.onAttachClose}
      />
    </>
  );
}
