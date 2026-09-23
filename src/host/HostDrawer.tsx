/** The v2 conversation menu, wired to the host's actions and conversation state. */
import { useState } from "react";
import { Keyboard } from "react-native";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { modes, type ThemeMode } from "../theme/design";
import { Drawer } from "../theme/components";
import { useLabTheme } from "../ui/labTheme";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;

export interface HostDrawerProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  conv: ConversationHost;
  actions: ConversationActions;
  onExportPress: (conversationId: string) => void;
}

export function HostDrawer({ open, setOpen, conv, actions, onExportPress }: HostDrawerProps) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const closeDrawer = () => {
    Keyboard.dismiss();
    setOpen(false);
    conv.clearChatSearch();
  };
  const conversationItems = actions.drawerConversationItems(
    conv.conversations,
    conv.chatSearchQuery,
    (id) => {
      Keyboard.dismiss();
      setSelectedConversationId(id);
    },
    onExportPress,
  );
  const selectedConversation = conversationItems.find((item) => item.id === selectedConversationId);
  const rows = selectedConversation?.actions?.map((action) => ({
    ...action,
    onPress: () => {
      setSelectedConversationId(null);
      if (action.id === "export") closeDrawer();
      action.onPress();
    },
  }));

  return (
    <>
      <Drawer
        open={open}
        onClose={closeDrawer}
        brand="Kalsa"
        items={actions.drawerItems()}
        conversationItems={conversationItems}
        searchValue={conv.chatSearch}
        searchQuery={conv.chatSearchQuery}
        onSearchChange={conv.handleChatSearchChange}
        onNewChat={() => actions.handleNewConversation()}
      />
      {selectedConversation && rows ? (
        <AttachSheet rows={rows} colors={colors} onClose={() => setSelectedConversationId(null)} />
      ) : null}
    </>
  );
}
