/**
 * The composer's toolbar row: the templates ✦ entry and the one-shot mode
 * chips, lifted from the old screen; the quick-actions sheet itself is CALLED
 * by the host (`HostChatSurface`), never rebuilt.
 *
 * Paint vs box, the source-chip doctrine (`shellGeometry.ts`): the painted pill
 * stays small (~28 dp), centred in the row's real `COMPOSER_TOOLBAR_HEIGHT`
 * box; every node the finger lands on is 48 dp on both axes — never `hitSlop`.
 *
 * The library-document ENTRY is not in this row — a §2.7 stub that could not
 * do its job, undiscoverable behind a scroller and inert when found (the
 * arithmetic: `composerToolbarWidth.test.ts` — three chips overflow 349 dp in
 * both catalogues). The attach flow landed and the entry moved to the ATTACH
 * SHEET (`HostAttachSheet.tsx`), where a finger looks for "attach something".
 * What remains here — templates, research, notes — fits 349 dp without
 * scrolling, which is why the row still scrolls but never has to.
 */
import type React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ClipboardList, Search, Sparkles } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { radius, spacing, type, type DesignColors } from "../../theme/design";
import {
  COMPOSER_TOOLBAR_HEIGHT,
  TOOLBAR_CHIP_ICON,
  TOOLBAR_CHIP_LABEL_GAP,
} from "./shellGeometry";

export type ComposerToolbarProps = {
  /** The quick-templates sheet entry (D1 row 13); never held while generating. */
  onTemplatesPress: () => void;
  researchActive: boolean;
  onResearchPress: () => void;
  notesActive: boolean;
  onNotesPress: () => void;
  /** The machine's answer: the chips cannot flip an arm while the face says
   *  stop. */
  disabled?: boolean;
};

function Chip({
  testID,
  icon,
  label,
  a11yLabel,
  active,
  disabled = false,
  toggle,
  onPress,
  colors,
}: {
  testID: string;
  icon: React.ReactNode;
  label: string;
  a11yLabel: string;
  active: boolean;
  disabled?: boolean;
  toggle: boolean;
  onPress: () => void;
  colors: DesignColors;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessible
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={a11yLabel}
      accessibilityState={toggle ? { checked: active, disabled } : { selected: active, disabled }}
      style={({ pressed }) => ({
        height: COMPOSER_TOOLBAR_HEIGHT,
        justifyContent: "center",
        opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: TOOLBAR_CHIP_LABEL_GAP,
          paddingHorizontal: spacing.sm,
          paddingVertical: 5,
          borderRadius: radius.md,
          backgroundColor: active ? `${colors.accent}22` : colors.surface,
          borderWidth: 1,
          borderColor: active ? colors.accent : colors.border,
        }}
      >
        {icon}
        <Text style={[type.meta, { color: active ? colors.accent : colors.ink }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function ComposerToolbar(props: ComposerToolbarProps & { colors: DesignColors }) {
  const { t } = useLocale();
  const { colors, disabled = false } = props;
  const iconTint = (active: boolean) => (active ? colors.accent : colors.silence);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        height: COMPOSER_TOOLBAR_HEIGHT,
        paddingHorizontal: spacing.md,
      }}
      testID="shell.composer.toolbar"
    >
      <Pressable
        testID="shell.composer.templates"
        accessibilityRole="button"
        accessibilityLabel={t("chat.a11yTemplates")}
        onPress={props.onTemplatesPress}
        style={({ pressed }) => ({
          width: COMPOSER_TOOLBAR_HEIGHT,
          height: COMPOSER_TOOLBAR_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Sparkles size={18} color={colors.accent} />
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.xs }}
        style={{ flex: 1 }}
      >
        <Chip
          testID="shell.composer.research"
          icon={<Search size={TOOLBAR_CHIP_ICON} color={iconTint(props.researchActive)} />}
          label={t("chat.deepResearch")}
          a11yLabel={
            props.researchActive ? t("chat.deepResearchActive") : t("chat.deepResearch")
          }
          active={props.researchActive}
          disabled={disabled}
          toggle
          onPress={props.onResearchPress}
          colors={colors}
        />
        <Chip
          testID="shell.composer.notes"
          icon={<ClipboardList size={TOOLBAR_CHIP_ICON} color={iconTint(props.notesActive)} />}
          label={t("notes.title")}
          a11yLabel={t("notes.title")}
          active={props.notesActive}
          disabled={disabled}
          toggle
          onPress={props.onNotesPress}
          colors={colors}
        />
      </ScrollView>
    </View>
  );
}
