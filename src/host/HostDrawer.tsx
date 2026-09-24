/** The v2 menu: global destinations, search and a compact route to conversations. */
import { Keyboard } from "react-native";
import { Drawer } from "../theme/components/Drawer";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;

export interface HostDrawerProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  conv: ConversationHost;
  actions: ConversationActions;
  onOpenConversations: () => void;
}

/** Keep the search query while moving from the menu into the full-screen list. */
export function openConversationListFromDrawer(
  dismissKeyboard: () => void,
  closeDrawer: () => void,
  openList: () => void,
): void {
  dismissKeyboard();
  closeDrawer();
  openList();
}

export function HostDrawer({ open, setOpen, conv, actions, onOpenConversations }: HostDrawerProps) {
  const closeDrawer = () => {
    Keyboard.dismiss();
    setOpen(false);
    conv.clearChatSearch();
  };
  const openConversations = () => openConversationListFromDrawer(
    Keyboard.dismiss,
    () => setOpen(false),
    onOpenConversations,
  );

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      brand="Kalsa"
      items={actions.drawerItems()}
      searchValue={conv.chatSearch}
      onSearchChange={conv.handleChatSearchChange}
      onConversationsPress={openConversations}
      onNewChat={() => actions.handleNewConversation()}
    />
  );
}
