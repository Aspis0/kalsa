/** The v2 conversation menu, wired to the host's actions and conversation state. */
import { Keyboard } from "react-native";
import { Drawer } from "../theme/components";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;

export interface HostDrawerProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  conv: ConversationHost;
  actions: ConversationActions;
}

export function HostDrawer({ open, setOpen, conv, actions }: HostDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={() => {
        Keyboard.dismiss();
        setOpen(false);
        conv.clearChatSearch();
      }}
      brand="Kalsa"
      items={actions.drawerItems()}
      conversationItems={actions.drawerConversationItems(conv.conversations, conv.chatSearchQuery)}
      searchValue={conv.chatSearch}
      searchQuery={conv.chatSearchQuery}
      onSearchChange={conv.handleChatSearchChange}
      onNewChat={() => actions.handleNewConversation()}
    />
  );
}
