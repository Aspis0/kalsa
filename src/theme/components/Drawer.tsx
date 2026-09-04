import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../../i18n";
import { useLabTheme } from "../../ui/labTheme";
import { chatMenuOriginX, chatMenuOriginY } from "./chatNavLayout";
import { DrawerContent } from "./DrawerContent";
import { LeafPaper } from "./LeafPaper";
import { leafContentPad } from "./leafPath";
import { useLeafFold } from "./useLeafFold";

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

/** Callers close the drawer on row actions; onClose is backdrop / Android back. */
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
  /** Measured height of the AppShell block above ChatNavBar (includes status inset). */
  modelBarHeight?: number;
};

export function Drawer({
  open,
  onClose,
  brand = "Kalsa",
  subtitle,
  items,
  conversationItems,
  searchValue,
  searchQuery,
  onSearchChange,
  onNewChat,
  personaLabel,
  onPersonaPress,
  modelBarHeight = 0,
}: Props) {
  const { colors } = useLabTheme<any>();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [stage, setStage] = useState({ width: win.width, height: win.height });
  const fold = useLeafFold(open);

  useEffect(() => {
    if (open) setStage({ width: win.width, height: win.height });
  }, [open]);

  if (!fold.mounted) return null;

  const { width, height } = stage;
  const originX = chatMenuOriginX();
  // Idle fallback ≈ title 22 + chip 16 + pads 6 until AppShell onLayout.
  const originY = chatMenuOriginY(modelBarHeight > 0 ? modelBarHeight : insets.top + 44);
  const pad = leafContentPad(width, height);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.frame} accessibilityViewIsModal>
        <Animated.View
          pointerEvents={fold.backdropLive ? "auto" : "none"}
          style={[styles.fill, fold.backdropStyle]}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            style={[styles.fill, { backgroundColor: colors.leafBackdrop }]}
          />
        </Animated.View>
        <Animated.View
          collapsable={false}
          pointerEvents="box-none"
          style={[styles.fill, { transformOrigin: [originX, originY] }, fold.paperStyle]}
        >
          <LeafPaper
            width={width}
            height={height}
            colors={colors}
            flapStyle={fold.flapStyle}
            flapFrontStyle={fold.flapFrontStyle}
            flapBackStyle={fold.flapBackStyle}
            creaseStyle={fold.creaseStyle}
            shadeStyle={fold.shadeStyle}
          />
          <Animated.View pointerEvents={fold.contentLive ? "auto" : "none"} style={[styles.fill, pad, fold.contentStyle]}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <DrawerContent
                brand={brand}
                subtitle={subtitle}
                items={items}
                conversationItems={conversationItems}
                searchValue={searchValue}
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onNewChat={onNewChat}
                personaLabel={personaLabel}
                onPersonaPress={onPersonaPress}
              />
            </KeyboardAvoidingView>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
