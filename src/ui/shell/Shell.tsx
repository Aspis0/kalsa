/**
 * The shell: three bands, static chrome, no engine calls.
 *
 * Step 2 of the rebuild, with step 3's transcript arriving as `children`. This
 * file places the boxes `shellGeometry.ts` returns and nothing else — it holds
 * no data, fetches nothing, and imports nothing from `src/engine`, `src/app`,
 * `src/screens` or `src/conversations`. The composer is non-functional chrome
 * until step 5; the send and attach controls deliberately do nothing.
 *
 * Insets arrive as a prop so `shellGeometry.ts` stays pure and its test honest;
 * width and height default to the live window so the preview can render at any
 * size the emulator reports.
 */
import { ArrowUp, ChevronDown, Menu, Mic, Plus } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { useLocale } from "../../i18n";
import {
  elevation,
  families,
  measure,
  modes,
  radius,
  spacing,
  type,
  type DesignColors,
  type ThemeMode,
} from "../../theme/design";
import {
  COMPOSER_FIELD_HEIGHT,
  COMPOSER_SIDE_PADDING,
  MIN_TOUCH_TARGET,
  STRIP_GAP,
  STRIP_MARK_SIZE,
  STRIP_SIDE_PADDING,
  shellGeometry,
  type Insets,
} from "./shellGeometry";

/**
 * The app's logo, and one of the three assets the rebuild keeps (DESIGN.md
 * §1.2): the neural-leaf mark, the same file `app.config.js` ships as the
 * launcher icon and the mock draws as `.pick .mark`. It is `require`d rather
 * than drawn, because the strip's mark is the one place the brand is visible.
 * `shellLogoAsset.test.ts` reads this file, pulls this path out and proves the
 * file exists, so a typo cannot ship the blank disc again.
 */
const LOGO = require("../../../assets/icon.png");

export type ShellProps = {
  /** Safe-area insets, in dp. */
  insets: Insets;
  /** The strip's static text. Translation stays with the caller. */
  modelName: string;
  whereLabel: string;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The transcript band's content. The shell does not know what it is. */
  children?: React.ReactNode;
  onMenuPress?: () => void;
  onModelPress?: () => void;
  onNewChatPress?: () => void;
  onAttachPress?: () => void;
  onMicPress?: () => void;
  onSendPress?: () => void;
};

export function Shell({
  insets,
  modelName,
  whereLabel,
  width,
  height,
  mode = "light",
  children,
  onMenuPress,
  onModelPress,
  onNewChatPress,
  onAttachPress,
  onMicPress,
  onSendPress,
}: ShellProps) {
  const { t } = useLocale();
  const window = useWindowDimensions();
  const colors = modes[mode];
  const styles = useMemo(() => createShellStyles(colors), [colors]);
  const geometry = useMemo(
    () => shellGeometry(width ?? window.width, height ?? window.height, insets),
    [width, height, window.width, window.height, insets.top, insets.bottom],
  );
  const [draft, setDraft] = useState("");

  const iconColor = colors.inkSoft;

  return (
    <View style={styles.root} testID="shell.root">
      <View
        style={[styles.strip, { height: geometry.strip.height, marginTop: insets.top }]}
        testID="shell.strip"
        accessibilityRole="header"
        accessibilityLabel={t("shell.a11y.band")}
      >
        <Pressable
          testID="shell.strip.menu"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.menu")}
          onPress={onMenuPress}
          style={styles.iconButton}
        >
          <Menu size={18} color={iconColor} strokeWidth={2.1} />
        </Pressable>

        <Pressable
          testID="shell.strip.model"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.modelSwitcher", { model: modelName, where: whereLabel })}
          onPress={onModelPress}
          style={styles.pill}
        >
          <View
            accessibilityElementsHidden
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.mark}
          >
            <Image resizeMode="cover" source={LOGO} style={styles.markImage} />
          </View>
          <View style={styles.pillText}>
            <Text style={styles.modelName} numberOfLines={1}>
              {modelName}
            </Text>
            {geometry.stripCollapsed ? null : (
              <View style={styles.whereRow}>
                <View style={styles.whereDot} />
                <Text style={styles.where} numberOfLines={1}>
                  {whereLabel}
                </Text>
              </View>
            )}
          </View>
          <ChevronDown size={15} color={colors.silence} strokeWidth={2.4} />
        </Pressable>

        <Pressable
          testID="shell.strip.newChat"
          accessibilityRole="button"
          accessibilityLabel={t("shell.a11y.newChat")}
          onPress={onNewChatPress}
          style={styles.iconButton}
        >
          <Plus size={18} color={iconColor} strokeWidth={2.1} />
        </Pressable>
      </View>

      <View
        style={[styles.transcript, { height: geometry.transcript.height }]}
        testID="shell.transcript"
        accessibilityLabel={t("shell.a11y.transcript")}
      >
        {children}
      </View>

      <View
        style={[styles.composerBand, { height: geometry.composer.height, marginBottom: insets.bottom }]}
        testID="shell.composer"
      >
        <View style={styles.field}>
          <Pressable
            testID="shell.composer.attach"
            accessibilityRole="button"
            accessibilityLabel={t("shell.a11y.attach")}
            onPress={onAttachPress}
            style={styles.fieldIcon}
          >
            <Plus size={19} color={colors.silence} strokeWidth={1.9} />
          </Pressable>

          <TextInput
            testID="shell.composer.field"
            accessibilityLabel={t("shell.a11y.field")}
            placeholder={t("shell.composer.placeholder")}
            placeholderTextColor={colors.silence}
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
            returnKeyType="send"
          />

          <Pressable
            testID="shell.composer.mic"
            accessibilityRole="button"
            accessibilityLabel={t("shell.a11y.mic")}
            onPress={onMicPress}
            style={styles.fieldIcon}
          >
            <Mic size={19} color={colors.silence} strokeWidth={1.9} />
          </Pressable>

          <Pressable
            testID="shell.composer.send"
            accessibilityRole="button"
            accessibilityLabel={t("shell.a11y.send")}
            onPress={onSendPress}
            style={styles.send}
          >
            <ArrowUp size={18} color={colors.onAccent} strokeWidth={2.6} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createShellStyles(colors: DesignColors) {
  return StyleSheet.create({
    root: {
      backgroundColor: colors.page,
      flex: 1,
    },
    strip: {
      alignItems: "center",
      flexDirection: "row",
      gap: STRIP_GAP,
      paddingHorizontal: STRIP_SIDE_PADDING,
    },
    iconButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
      ...elevation.raised,
    },
    pill: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      flex: 1,
      flexDirection: "row",
      gap: spacing.sm,
      height: MIN_TOUCH_TARGET,
      minWidth: 0,
      paddingHorizontal: spacing.sm,
      ...elevation.raised,
    },
    mark: {
      // The mock's `.pick .mark`: a 28 dp circular clip with the raster filling
      // it (`object-fit: cover`). `icon.png` is the full-bleed plate — unlike
      // the composer's JPEGs it carries no sage margin — so cover needs no
      // scale. The ground only shows while the image decodes.
      backgroundColor: colors.surfaceMuted,
      borderRadius: STRIP_MARK_SIZE / 2,
      height: STRIP_MARK_SIZE,
      overflow: "hidden",
      width: STRIP_MARK_SIZE,
    },
    markImage: {
      height: STRIP_MARK_SIZE,
      width: STRIP_MARK_SIZE,
    },
    pillText: {
      flex: 1,
      minWidth: 0,
    },
    modelName: {
      color: colors.ink,
      fontFamily: families.sansSemi,
      fontSize: type.label.fontSize,
      letterSpacing: -0.1,
      lineHeight: type.label.lineHeight,
    },
    whereRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.xxs,
    },
    whereDot: {
      backgroundColor: colors.accent,
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    where: {
      color: colors.silence,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
    },
    transcript: {
      overflow: "hidden",
      paddingHorizontal: measure.gutterCompact,
    },
    composerBand: {
      justifyContent: "flex-start",
      paddingBottom: spacing.md,
      paddingHorizontal: COMPOSER_SIDE_PADDING,
      paddingTop: spacing.sm,
    },
    field: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      flexDirection: "row",
      gap: spacing.sm,
      height: COMPOSER_FIELD_HEIGHT,
      paddingHorizontal: spacing.sm,
      ...elevation.dock,
    },
    fieldIcon: {
      alignItems: "center",
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
    input: {
      color: colors.ink,
      flex: 1,
      fontFamily: families.reading,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      minWidth: 0,
      padding: 0,
      textAlignVertical: "center",
    },
    send: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: MIN_TOUCH_TARGET / 2,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      width: MIN_TOUCH_TARGET,
    },
  });
}
