/**
 * The conversation drawer, wired to the host — extracted from `HostRoot.tsx`
 * (the root may only compose). The JSX and every handler are the root's old
 * ones moved verbatim: close clears the drawer AND the search, the persona row
 * opens the personas overlay, and the model-bar height offsets the strip.
 *
 * It also holds EXPORT now (D1 row 2's share): the strip gave the model pill a
 * 14 dp text column with five controls on 349 dp — 349 - 2*12 - 4*48 - 4*9 =
 * 97 dp for the pill — and the model name is the thing that may shrink, not
 * this. The row is chat-level, the drawer already exists, and the press is the
 * strip's old one: dismiss the keyboard, close the drawer, then the same
 * `shareConversation` the root used to hand the strip.
 */
import { Keyboard } from "react-native";
import { Share } from "lucide-react-native";
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
  /** Export/share of the live conversation (D1 row 2), built by the root —
   *  the action the strip carried before the pill needed the width. */
  onExportPress: () => void;
}

export function HostDrawer({
  insets,
  open,
  setOpen,
  conv,
  actions,
  personas,
  setActiveOverlay,
  onExportPress,
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
      items={[
        ...actions.drawerItems(),
        {
          // The strip's old share button, on a drawer tile: 48 dp floor and
          // testID come from the row renderer (`DrawerContent.tsx`), the label
          // is the controller's own `chat.a11yExport` from both catalogues.
          id: "export",
          label: t("chat.a11yExport"),
          Icon: Share,
          onPress: () => {
            Keyboard.dismiss();
            conv.clearChatSearch();
            setOpen(false);
            onExportPress();
          },
        },
      ]}
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
