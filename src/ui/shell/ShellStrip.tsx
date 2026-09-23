/** The conversation's 56 dp navigation and model control strip. */
import { ChevronDown, Menu, Monitor, Smartphone } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocale } from "../../i18n";
import { e1, families, measure, modes, radius, space, type, type ThemeMode } from "../../theme/design";
import { ModelPillSheet } from "./ModelPillSheet";
import { shellLocationLabel } from "./shellLocationLabel";
import {
  STRIP_CHEVRON_SIZE,
  STRIP_DEVICE_SIZE,
  STRIP_HEIGHT,
  STRIP_PILL_HEIGHT,
  type Insets,
} from "./shellGeometry";
import type { ModelBarView } from "./ModelBar";

export function ShellStrip({
  insets,
  modelName,
  location,
  whereLabel,
  mode,
  modelBar,
  onMenuPress,
  onModelAction,
}: {
  insets: Insets;
  modelName: string;
  location: "phone" | "server";
  whereLabel?: string;
  mode: ThemeMode;
  modelBar?: ModelBarView;
  onMenuPress?: () => void;
  onModelAction?: () => void;
}) {
  const { t } = useLocale();
  const colors = modes[mode];
  const [sheetVisible, setSheetVisible] = useState(false);
  const DeviceIcon = location === "phone" ? Smartphone : Monitor;
  const locationLabel = whereLabel ?? shellLocationLabel(location, {
    local: t("shell.where.pillLocal"),
    computer: t("shell.where.pillComputer"),
  });
  const iconColor = colors.ink2;
  const refused = modelBar?.status.tone === "bad";

  return (
    <>
      <View
        style={{
          height: STRIP_HEIGHT,
          marginTop: insets.top,
          paddingHorizontal: measure.gutter,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
        testID="shell.strip"
        accessibilityRole="header"
        accessibilityLabel={t("shell.a11y.band")}
      >
        <Pressable
          testID="shell.strip.menu"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.menu")}
          onPress={onMenuPress}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Menu size={20} color={iconColor} strokeWidth={1.75} />
        </Pressable>

        <Pressable
          testID="shell.strip.model"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.modelSwitcher", { model: modelName, where: locationLabel })}
          onPress={() => setSheetVisible(true)}
          style={({ pressed }) => ({
            height: 48,
            flex: 1,
            minWidth: 0,
            justifyContent: "center",
            opacity: pressed ? 0.78 : 1,
          })}
        >
          <View
            style={{
              height: STRIP_PILL_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingHorizontal: space.sm,
              borderRadius: radius.pill,
              backgroundColor: refused ? colors.tint : colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              ...e1,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: refused ? colors.ink3 : colors.ink,
                fontFamily: families.sansSemi,
                fontSize: type.bodyStrong.fontSize,
                lineHeight: type.bodyStrong.lineHeight,
                flexShrink: 0,
              }}
            >
              {modelName}
            </Text>
            <DeviceIcon size={STRIP_DEVICE_SIZE} color={refused ? colors.ink3 : colors.accent} strokeWidth={1.75} />
            <Text
              numberOfLines={1}
              style={{ fontFamily: families.sansMedium, fontSize: 11.5, lineHeight: 14, color: colors.ink3, flex: 1 }}
            >
              {locationLabel}
            </Text>
            <ChevronDown size={STRIP_CHEVRON_SIZE} color={colors.ink3} strokeWidth={2} />
          </View>
        </Pressable>
      </View>
      <ModelPillSheet
        visible={sheetVisible}
        modelName={modelName}
        mode={mode}
        view={modelBar}
        onRetryPress={onModelAction}
        onClose={() => setSheetVisible(false)}
      />
    </>
  );
}
