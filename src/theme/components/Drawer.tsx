/** Full-height v2 conversation menu. The public props stay compatible with both roots. */
import { KeyboardAvoidingView, Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { modes, type ThemeMode } from "../design";
import { useLabTheme } from "../../ui/labTheme";
import { DrawerContent } from "./DrawerContent";

export type DrawerItem = {
  id: string;
  label: string;
  Icon: React.ComponentType<any>;
  lastUsed?: string;
  onPress: () => void;
};

export type DrawerConversationItem = {
  id: string;
  title: string;
  preview?: string;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  brand?: string;
  subtitle?: string;
  items: DrawerItem[];
  conversationItems?: DrawerConversationItem[];
  searchValue?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onNewChat?: () => void;
  personaLabel?: string;
  onPersonaPress?: () => void;
  /** Kept for the old root's call shape; v2 uses the device safe-area inset. */
  modelBarHeight?: number;
};

/** Row presses close through their host callbacks; the header and BACK dismiss directly. */
export function Drawer({
  open,
  onClose,
  brand = "Kalsa",
  items,
  conversationItems,
  searchValue,
  searchQuery,
  onSearchChange,
  onNewChat,
}: Props) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const insets = useSafeAreaInsets();
  const colors = modes[mode];

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        testID="drawer.root"
        style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom }}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <DrawerContent
            brand={brand}
            items={items}
            conversationItems={conversationItems}
            searchValue={searchValue}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onNewChat={onNewChat}
            onClose={onClose}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
