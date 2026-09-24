/** The v2 menu contents: brand, new chat, search, a chat-list entry and five destinations. */
import { Image, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { ChevronLeft, ChevronRight, MessageSquare, Plus, Search, X } from "lucide-react-native";
import { useLocale } from "../../i18n";
import { modes, measure, radius, space, type, type ThemeMode } from "../design";
import { useLabTheme } from "../../ui/labTheme";
import type { DrawerItem } from "./Drawer";

type Props = {
  brand: string;
  items: DrawerItem[];
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  onConversationsPress?: () => void;
  onNewChat?: () => void;
  onClose: () => void;
};

export function DrawerContent({
  brand,
  items,
  searchValue = "",
  onSearchChange,
  onConversationsPress,
  onNewChat,
  onClose,
}: Props) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const { t } = useLocale();
  const colors = modes[mode];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const destinations = ["documents", "notes", "settings", "account", "personas"]
    .map((id) => itemById.get(id))
    .filter((item): item is DrawerItem => item !== undefined);

  return (
    <View style={{ flex: 1, paddingHorizontal: measure.gutter, gap: space.sm }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Image
          source={require("../../../assets/icon.png")}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ width: 36, height: 36, borderRadius: 18 }}
        />
        <Text style={[type.title, { color: colors.ink, fontSize: 24, flex: 1 }]}>{brand}</Text>
        <Pressable
          testID="drawer.close"
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.button,
            backgroundColor: pressed ? colors.tint : "transparent",
          })}
        >
          <ChevronLeft size={20} color={colors.ink2} strokeWidth={1.75} />
        </Pressable>
      </View>

      {onNewChat ? (
        <Pressable
          testID="drawer.newChat"
          accessibilityRole="button"
          accessibilityLabel={t("drawer.newChat")}
          onPress={onNewChat}
          style={({ pressed }) => ({
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.xs,
            borderRadius: radius.button,
            backgroundColor: pressed ? colors.brandDeep : colors.brand,
          })}
        >
          <Plus size={20} color={colors.onBrand} strokeWidth={2} />
          <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("drawer.newChat")}</Text>
        </Pressable>
      ) : null}

      {onSearchChange ? (
        <View
          style={{
            height: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.field,
            backgroundColor: colors.surface,
          }}
        >
          <Search size={20} color={colors.ink3} strokeWidth={1.75} />
          <TextInput
            testID="drawer.search"
            value={searchValue}
            onChangeText={onSearchChange}
            placeholder={t("drawer.searchChats")}
            placeholderTextColor={colors.ink3}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={t("drawer.searchChats")}
            onSubmitEditing={() => onConversationsPress ? onConversationsPress() : Keyboard.dismiss()}
            style={[type.body, { flex: 1, color: colors.ink, padding: 0 }]}
          />
          {searchValue.length > 0 ? (
            <Pressable
              testID="drawer.search.clear"
              accessibilityRole="button"
              accessibilityLabel={t("common.clear")}
              onPress={() => onSearchChange("")}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <X size={18} color={colors.ink3} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {onConversationsPress ? (
        <Pressable
          testID="drawer.conversations.open"
          accessibilityRole="button"
          accessibilityLabel={t("drawer.yourChats")}
          onPress={onConversationsPress}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.xs,
            borderRadius: radius.row,
            backgroundColor: pressed ? colors.tint : "transparent",
          })}
        >
          <MessageSquare size={20} color={colors.accent} strokeWidth={1.75} />
          <Text style={[type.headline, { color: colors.ink, flex: 1 }]}>{t("drawer.yourChats")}</Text>
          <ChevronRight size={16} color={colors.ink3} strokeWidth={1.75} />
        </Pressable>
      ) : null}

      <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.xs }}>
        {destinations.map(({ id, label, Icon, onPress }) => (
          <Pressable
            key={id}
            testID={`drawer.item.${id}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.xs,
              backgroundColor: pressed ? colors.tint : "transparent",
            })}
          >
            <Icon color={colors.accent} size={20} strokeWidth={1.75} />
            <Text style={[type.headline, { color: colors.ink, flex: 1 }]}>{label}</Text>
            <ChevronRight size={16} color={colors.ink3} strokeWidth={1.75} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
