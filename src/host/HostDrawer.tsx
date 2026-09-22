/**
 * The conversation drawer, wired to the host — extracted from `HostRoot.tsx`
 * (the root may only compose). The JSX and every handler are the root's old
 * ones moved verbatim: close clears the drawer AND the search, the persona row
 * opens the personas overlay, and the model-bar height offsets the strip.
 */
import { findPersona } from "../conversations/PersonasStore";
import { builtinCopyFromT } from "../screens/PersonasScreen";
import { useLocale } from "../i18n";
import { Drawer } from "../theme/components";
import { STRIP_HEIGHT } from "../ui/shell/shellGeometry";
import type { createConversationActions } from "./conversationActions";
import type { useConversationHost } from "./useConversationHost";
import type { usePersonasHost } from "./personasHost";
import type { HostOverlay } from "./hostOverlay";

type ConversationHost = ReturnType<typeof useConversationHost>;
type ConversationActions = ReturnType<typeof createConversationActions>;
type PersonasHost = ReturnType<typeof usePersonasHost>;

export interface HostDrawerProps {
  insets: { top: number; bottom: number };
  open: boolean;
  setOpen: (open: boolean) => void;
  conv: ConversationHost;
  actions: ConversationActions;
  personas: PersonasHost;
  setActiveOverlay: (overlay: HostOverlay) => void;
}

export function HostDrawer({
  insets,
  open,
  setOpen,
  conv,
  actions,
  personas,
  setActiveOverlay,
}: HostDrawerProps) {
  const { t } = useLocale();
  return (
    <Drawer
      open={open}
      onClose={() => {
        setOpen(false);
        conv.clearChatSearch();
      }}
      brand="Kalsa"
      subtitle={t("drawer.subtitle")}
      items={actions.drawerItems()}
      conversationItems={actions.drawerConversationItems(
        conv.conversations,
        conv.chatSearchQuery,
      )}
      searchValue={conv.chatSearch}
      searchQuery={conv.chatSearchQuery}
      onSearchChange={conv.handleChatSearchChange}
      onNewChat={() => actions.handleNewConversation()}
      personaLabel={
        findPersona(personas.personasState, personas.activePersonaId, builtinCopyFromT(t))
          ?.name ?? t("drawer.personaNone")
      }
      modelBarHeight={insets.top + STRIP_HEIGHT}
      onPersonaPress={() => {
        setOpen(false);
        conv.clearChatSearch();
        setActiveOverlay({ kind: "personas" });
      }}
    />
  );
}
