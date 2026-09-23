import type { TranslateFn } from "../i18n";
import type { DrawerConversationAction } from "../theme/components/Drawer";

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
