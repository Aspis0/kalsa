/** The v2 menu: global destinations, search and a compact route to conversations. */
import { Keyboard } from "react-native";
import { MessagesSquare } from "lucide-react-native";
import { useLocale } from "../i18n";
import { useRoomPairing } from "../room/useRoomPairing";
import { Drawer, type DrawerItem } from "../theme/components/Drawer";
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
  /** Open one paired computer's room. The entry is offered only while a
   *  usable pairing exists, and v1 has no picker: the newest one. */
  onOpenRoom: (localId: string) => void;
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

export function HostDrawer({
  open,
  setOpen,
  conv,
  actions,
  onOpenConversations,
  onOpenRoom,
}: HostDrawerProps) {
  const { t } = useLocale();
  const room = useRoomPairing();
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

  const items: DrawerItem[] = actions.drawerItems();
  if (room.localId !== null) {
    const localId = room.localId;
    items.push({
      id: "room",
      label: t("room.title"),
      Icon: MessagesSquare,
      onPress: () => {
        closeDrawer();
        onOpenRoom(localId);
      },
    });
  }

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      brand="Kalsa"
      items={items}
      searchValue={conv.chatSearch}
      onSearchChange={conv.handleChatSearchChange}
      onConversationsPress={openConversations}
      onNewChat={() => actions.handleNewConversation()}
    />
  );
}
