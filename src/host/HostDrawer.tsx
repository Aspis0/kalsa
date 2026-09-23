/** The v2 conversation menu, wired to the host's actions and conversation state. */
import { Keyboard } from "react-native";
import { Share } from "lucide-react-native";
import { useLocale } from "../i18n";
import { Drawer } from "../theme/components";
import { createExportDrawerItem } from "./exportDrawerItem";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;

export interface HostDrawerProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  conv: ConversationHost;
  actions: ConversationActions;
  onExportPress: () => void;
}

export function HostDrawer({ open, setOpen, conv, actions, onExportPress }: HostDrawerProps) {
  const { t } = useLocale();
  const closeDrawer = () => {
    Keyboard.dismiss();
    setOpen(false);
    conv.clearChatSearch();
  };
  const exportItem = createExportDrawerItem(t("chat.a11yExport"), Share, () => {
    closeDrawer();
    onExportPress();
  });

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      brand="Kalsa"
      items={[...actions.drawerItems(), exportItem]}
      conversationItems={actions.drawerConversationItems(conv.conversations, conv.chatSearchQuery)}
      searchValue={conv.chatSearch}
      searchQuery={conv.chatSearchQuery}
      onSearchChange={conv.handleChatSearchChange}
      onNewChat={() => actions.handleNewConversation()}
    />
  );
}
