/** Full-screen, searchable conversation destination opened from the menu. */
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useCallback, useEffect } from "react";
import { ChevronRight, MessageSquare, Search, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { families, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import type { DrawerConversationItem } from "../theme/components/Drawer";
import { SettingsHeader } from "./SettingsHeader";

type Props = {
  items: DrawerConversationItem[];
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
};

export function ConversationListScreen({ items, query, onQueryChange, onBack }: Props) {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const handleBack = useCallback(() => onBack(), [onBack]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.page,
        zIndex: 50,
      }}
    >
      <SettingsHeader title={t("drawer.yourChats")} onBack={handleBack} backLabel={t("common.back")} />
      <View
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          marginHorizontal: space.md,
          marginTop: space.xs,
          marginBottom: space.sm,
          paddingHorizontal: space.md,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.field,
          backgroundColor: colors.surface,
        }}
      >
        <Search size={20} color={colors.ink3} strokeWidth={1.75} />
        <TextInput
          testID="conversationList.search"
          value={query}
          onChangeText={onQueryChange}
          placeholder={t("drawer.searchChats")}
          placeholderTextColor={colors.ink3}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={t("drawer.searchChats")}
          style={[type.body, { flex: 1, color: colors.ink, padding: 0 }]}
        />
        {query.length > 0 ? (
          <Pressable
            testID="conversationList.search.clear"
            accessibilityRole="button"
            accessibilityLabel={t("common.clear")}
            onPress={() => onQueryChange("")}
            style={{ width: 40, height: 48, alignItems: "center", justifyContent: "center" }}
          >
            <X size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        testID="conversationList.rows"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 0, paddingHorizontal: space.md, paddingBottom: insets.bottom + space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {items.length === 0 ? (
          <Text testID="conversationList.empty" style={[type.secondary, { color: colors.ink3, paddingVertical: space.md }]}>
            {t("drawer.noMatches")}
          </Text>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              testID={`conversationList.row.${item.id}`}
              onPress={item.onPress}
              onLongPress={item.onLongPress}
              delayLongPress={380}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              accessibilityHint={item.onLongPress ? t("drawer.conversationActionsHint") : undefined}
              accessibilityActions={
                item.onLongPress
                  ? [{ name: "conversationActions", label: t("drawer.conversationActions") }]
                  : undefined
              }
              onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "conversationActions") item.onLongPress?.();
              }}
              accessibilityState={{ selected: Boolean(item.active) }}
              style={({ pressed }) => ({
                flex: 0,
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.xs,
                borderRadius: radius.row,
                backgroundColor: item.active || pressed ? colors.tint : "transparent",
              })}
            >
              <MessageSquare size={20} color={colors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1, minWidth: 0, paddingVertical: space.xs }}>
                <Text
                  numberOfLines={1}
                  style={[
                    type.headline,
                    { color: colors.ink, fontFamily: item.active ? families.sansSemi : families.sans },
                  ]}
                >
                  {item.title}
                </Text>
                {item.preview ? (
                  <Text numberOfLines={1} style={[type.secondary, { color: colors.ink3, marginTop: 1 }]}>
                    {item.preview}
                  </Text>
                ) : null}
              </View>
              <ChevronRight size={16} color={colors.ink3} strokeWidth={1.75} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
