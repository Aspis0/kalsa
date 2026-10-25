/** Host wiring for the full-screen conversation list and its row action sheet. */
import { useState } from "react";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { modes, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { ConversationListScreen } from "../screens/ConversationListScreen";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";
import { bindConversationRowActions } from "./conversationRowActions";
import type { HostOverlay } from "./hostOverlay";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;

export interface HostConversationsProps {
  conv: ConversationHost;
  actions: ConversationActions;
  setOverlay: (overlay: HostOverlay) => void;
  onExportPress: (conversationId: string) => void;
}

export function HostConversations({ conv, actions, setOverlay, onExportPress }: HostConversationsProps) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const items = actions.drawerConversationItems(
    conv.conversations,
    conv.chatSearchQuery,
    setSelectedConversationId,
    onExportPress,
  ).map((item) => ({
    ...item,
    onPress: () => {
      setOverlay(null);
      item.onPress();
    },
  }));
  const selectedConversation = items.find((item) => item.id === selectedConversationId);
  const sheetRows = selectedConversation?.actions
    ? bindConversationRowActions(selectedConversation.actions, {
        closeSheet: () => setSelectedConversationId(null),
        closeDrawer: () => setOverlay(null),
      })
    : undefined;

  return (
    <>
      <ConversationListScreen
        items={items}
        query={conv.chatSearch}
        onQueryChange={conv.handleChatSearchChange}
        onBack={() => setOverlay(null)}
      />
      {selectedConversation && sheetRows ? (
        <AttachSheet
          title={selectedConversation.title}
          rows={sheetRows}
          colors={colors}
          onClose={() => setSelectedConversationId(null)}
        />
      ) : null}
    </>
  );
}
