import React, { useMemo } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight, Search } from "lucide-react-native";
import { useLocale } from "../../i18n";
import { useLabTheme } from "../../ui/labTheme";
import { tokensFromQuery } from "../../util/filterByTokens";
import { BrandIcon } from "../icons/BrandIcon";
import { radius, spacing } from "../tokens";
import { fontFamilies, typography } from "../typography";
import { highlightMatches } from "./highlightMatches";
import type { DrawerConversationItem, DrawerItem } from "./Drawer";

function renderHighlightedText(
  text: string,
  tokens: string[],
  accentColor: string,
): React.ReactNode {
  return highlightMatches(text, tokens).map((part, index) =>
    part.highlighted ? (
      <Text
        key={`match-${index}`}
        style={{
          color: accentColor,
          fontFamily: fontFamilies.bodySemi,
          textDecorationLine: "underline",
        }}
      >
        {part.text}
      </Text>
    ) : (
      <Text key={`plain-${index}`}>{part.text}</Text>
    ),
  );
}

/** Row presses do not call onClose — AppShell handlers close the drawer. */
type Props = {
  brand: string;
  subtitle?: string;
  items: DrawerItem[];
  conversationItems?: DrawerConversationItem[];
  searchValue?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onNewChat?: () => void;
  personaLabel?: string;
  onPersonaPress?: () => void;
};

export function DrawerContent({
  brand,
  subtitle,
  items,
  conversationItems,
  searchValue,
  searchQuery,
  onSearchChange,
  onNewChat,
  personaLabel,
  onPersonaPress,
}: Props) {
  const { colors } = useLabTheme<any>();
  const { t } = useLocale();
  const showConversations = Array.isArray(conversationItems);
  const emptySearch = Boolean(searchQuery?.trim()) && (conversationItems?.length ?? 0) === 0;
  const searchTokens = useMemo(
    () => tokensFromQuery(searchQuery ?? "") ?? [],
    [searchQuery],
  );
  const brandSize = ((typography.displayMd.fontSize as number) / 18) * 20;
  const ink = colors.leafInk;
  const muted = colors.leafMuted;
  const tile = {
    backgroundColor: colors.leafTile,
    borderWidth: 1,
    borderColor: colors.leafLine,
    borderRadius: 14,
  };
  const section = [
    typography.bodyXs,
    { color: muted, letterSpacing: 1, textTransform: "uppercase" as const, marginBottom: 6 },
  ];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[typography.displayMd, { color: ink, fontSize: brandSize }]}>{brand}</Text>
          {subtitle ? (
            <Text style={[typography.bodyXs, { color: muted, marginTop: 2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onPersonaPress ? (
          <Pressable
            onPress={onPersonaPress}
            accessibilityRole="button"
            accessibilityLabel={t("drawer.personas")}
            style={({ pressed }) => ({
              ...tile,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 5,
              paddingHorizontal: 10,
              maxWidth: "55%",
              borderRadius: radius.pill,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <LinearGradient
              colors={[colors.accent, colors.cyan]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 12, height: 12, borderRadius: 6 }}
            />
            <Text style={[typography.bodyXs, { color: ink, fontFamily: typography.bodySm.fontFamily }]} numberOfLines={1}>
              {personaLabel || t("drawer.personaNone")}
            </Text>
            <ChevronRight size={14} color={muted} />
          </Pressable>
        ) : null}
      </View>

      {onSearchChange ? (
        <View style={[tile, { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginBottom: 8, borderRadius: 12 }]}>
          <Search size={14} color={muted} />
          <TextInput
            value={searchValue ?? ""}
            onChangeText={onSearchChange}
            placeholder={t("drawer.searchChats")}
            placeholderTextColor={muted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            textContentType="none"
            clearButtonMode="while-editing"
            accessibilityLabel={t("drawer.searchChats")}
            onSubmitEditing={() => Keyboard.dismiss()}
            style={[typography.bodySm, { flex: 1, color: ink, paddingHorizontal: 8, paddingVertical: 9 }]}
          />
        </View>
      ) : null}

      {showConversations ? (
        <View>
          <Text style={section}>{t("drawer.chats")}</Text>
          {onNewChat ? (
            <Pressable
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel={t("drawer.newChat")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 4,
                borderRadius: 12,
                backgroundColor: pressed ? colors.leafTile : "transparent",
              })}
            >
              <BrandIcon name="new-chat" size={22} />
              <Text style={[typography.bodyMd, { color: ink, fontFamily: typography.bodySm.fontFamily }]}>
                {t("drawer.newChat")}
              </Text>
            </Pressable>
          ) : null}
          {emptySearch ? (
            <Text style={[typography.bodySm, { color: muted, paddingHorizontal: 12, paddingVertical: 10 }]}>
              {t("drawer.noMatches")}
            </Text>
          ) : (
            conversationItems.map((item) => (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                onLongPress={item.onLongPress}
                delayLongPress={380}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityState={{ selected: Boolean(item.active) }}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: item.active
                    ? colors.leafTileActive
                    : pressed
                      ? colors.leafTile
                      : "transparent",
                })}
              >
                <Text numberOfLines={1} style={[typography.bodyMd, { color: ink, fontFamily: typography.bodySm.fontFamily }]}>
                  {renderHighlightedText(item.title, searchTokens, colors.accent)}
                </Text>
                {item.preview ? (
                  <Text numberOfLines={1} style={[typography.bodyXs, { color: muted, marginTop: 2 }]}>
                    {renderHighlightedText(item.preview, searchTokens, colors.accent)}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <View style={{ flexGrow: 1, minHeight: 8 }} />
      <View style={{ height: 1, backgroundColor: colors.leafLine, marginVertical: 8, marginHorizontal: 2 }} />
      <Text style={section}>{t("drawer.toolsSection")}</Text>
      <View style={{ gap: 6, paddingBottom: 2 }}>
        {items.map(({ id, label, Icon, lastUsed, onPress }) => (
          <Pressable
            key={id}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 11,
              opacity: pressed ? 0.7 : 1,
              ...tile,
            })}
          >
            <Icon color={ink} size={17} />
            <Text style={[typography.bodyMd, { color: ink, flex: 1, fontFamily: typography.bodySm.fontFamily }]}>
              {label}
            </Text>
            {lastUsed ? <Text style={[typography.bodyXs, { color: muted }]}>{lastUsed}</Text> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
