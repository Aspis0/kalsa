import {
  filterConversations,
  type ConversationsState,
} from "../conversations/ConversationsStore";
import type { TranslateFn } from "../i18n";
import type {
  DrawerConversationAction,
  DrawerConversationItem,
} from "../theme/components/Drawer";

/** Build the actual drawer rows from conversation state, preserving each row's id. */
export function buildDrawerConversationItems(
  conversations: ConversationsState,
  query: string,
  untitledLabel: string,
  t: TranslateFn,
  onSwitch: (id: string) => void,
  onActionSheetOpen: (id: string) => void,
  onExport: (id: string) => void,
  onDelete: (id: string) => void,
): DrawerConversationItem[] {
  return filterConversations(conversations.items, query).map((item) => ({
    id: item.id,
    title: item.title.trim() ? item.title : untitledLabel,
    preview: item.preview,
    active: item.id === conversations.activeId,
    onPress: () => onSwitch(item.id),
    onLongPress: () => onActionSheetOpen(item.id),
    actions: createConversationRowActions(item.id, t, onExport, onDelete),
  }));
}

export function createConversationRowActions(
  conversationId: string,
  t: TranslateFn,
  onExport: (id: string) => void,
  onDelete: (id: string) => void,
): DrawerConversationAction[] {
  return [
    {
      id: "export",
      testID: `drawer.conversation.${conversationId}.export`,
      icon: "share",
      label: t("drawer.exportAction"),
      onPress: () => onExport(conversationId),
    },
    {
      id: "delete",
      testID: `drawer.conversation.${conversationId}.delete`,
      icon: "trash",
      label: t("drawer.deleteAction"),
      tone: "danger",
      onPress: () => onDelete(conversationId),
    },
  ];
}

/** Dismiss the row sheet, then the drawer for export, before running the row action. */
export function runConversationRowAction(
  action: DrawerConversationAction,
  closeSheet: () => void,
  closeDrawer: () => void,
): void {
  closeSheet();
  if (action.id === "export") closeDrawer();
  action.onPress();
}
