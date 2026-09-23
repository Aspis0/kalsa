import { useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import {
  Activity,
  ChevronRight,
  Cpu,
  Languages,
  Moon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Type,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale, type Locale } from "../i18n";
import {
  e1,
  modes,
  radius,
  space,
  type,
  type DesignColors,
  type ThemeMode,
} from "../theme/design";
import type { FontScaleId } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import { AttachSheet, type AttachSheetRowData } from "../ui/shell/AttachSheet";
import { SettingsHeader } from "./SettingsHeader";
import { settingsWebToggleProps } from "./settingsWebToggle";

type ModelOption = { id: string; label: string; detail: string; disabled: boolean };
type SheetName = "model" | "theme" | "size" | "language" | "permissions";
type Props = {
  onBack: () => void;
  onOpenAdvanced: () => void;
  modelOptions: readonly ModelOption[];
  currentModelId: string;
  modelBusy: boolean;
  onSelectModel: (id: string) => void;
  webEnabled?: boolean;
  onToggleWeb?: () => void;
  telemetryEnabled: boolean;
  telemetryBusy: boolean;
  onToggleTelemetry: (enabled: boolean) => void;
  deviceToolsEnabled: boolean;
  onToggleDeviceTools: (enabled: boolean) => void;
  calendarToolsEnabled: boolean;
  onToggleCalendarTools: (enabled: boolean) => void;
  appVersion: string;
};

type ThemeContext = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  fontScaleId: FontScaleId;
  setFontScaleId: (id: FontScaleId) => void;
};

type RowProps = {
  testID: string;
  title: string;
  subtitle?: string;
  value?: string;
  icon: ReactNode;
  onPress?: () => void;
  checked?: boolean;
  disabled?: boolean;
  colors: DesignColors;
};

function Row({ testID, title, subtitle, value, icon, onPress, checked, disabled = false, colors }: RowProps) {
  const content = (
    <>
      <View style={{ width: 20, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.bodyStrong, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={[type.secondary, { color: colors.ink2, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {checked === undefined ? (
        <>
          {value ? <Text numberOfLines={1} style={[type.secondary, { color: colors.ink3, maxWidth: 100 }]}>{value}</Text> : null}
          {onPress ? <ChevronRight size={18} color={colors.ink3} strokeWidth={1.75} /> : null}
        </>
      ) : (
        <View style={{ width: 48, height: 28, borderRadius: 999, padding: 2, backgroundColor: checked ? colors.brand : colors.line2, justifyContent: "center" }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.onBrand, alignSelf: checked ? "flex-end" : "flex-start" }} />
        </View>
      )}
    </>
  );
  const style = {
    minHeight: subtitle ? 64 : 56,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.sm,
    paddingHorizontal: space.md,
    opacity: disabled ? 0.5 : 1,
  };

  if (checked !== undefined) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ checked, disabled }}
        style={({ pressed }) => [style, pressed ? { backgroundColor: colors.tint } : null]}
      >
        {content}
      </Pressable>
    );
  }
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [style, pressed ? { backgroundColor: colors.tint } : null]}
      >
        {content}
      </Pressable>
    );
  }
  return <View testID={testID} style={style}>{content}</View>;
}

function Group({ title, colors, children }: { title: string; colors: DesignColors; children: ReactNode }) {
  return (
    <View style={{ flexGrow: 0, flexShrink: 0, backgroundColor: colors.surface, borderRadius: radius.card, overflow: "hidden", ...e1 }}>
      <Text style={[type.label, { color: colors.ink3, paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs }]}>
        {title.toLocaleUpperCase()}
      </Text>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      {children}
    </View>
  );
}

function Divider({ colors }: { colors: DesignColors }) {
  return <View style={{ height: 1, backgroundColor: colors.line }} />;
}

export function SettingsHomeScreen({
  onBack,
  onOpenAdvanced,
  modelOptions,
  currentModelId,
  modelBusy,
  onSelectModel,
  webEnabled,
  onToggleWeb,
  telemetryEnabled,
  telemetryBusy,
  onToggleTelemetry,
  deviceToolsEnabled,
  onToggleDeviceTools,
  calendarToolsEnabled,
  onToggleCalendarTools,
  appVersion,
}: Props) {
  const insets = useSafeAreaInsets();
  const { locale, setLocale, t } = useLocale();
  const { mode, setMode, fontScaleId, setFontScaleId } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const model = modelOptions.find((option) => option.id === currentModelId);
  const webToggleProps = settingsWebToggleProps(webEnabled, onToggleWeb);
  const fontScales: Array<{ id: FontScaleId; label: string }> = [
    { id: "s", label: t("settings.fontSizeS") },
    { id: "m", label: t("settings.fontSizeM") },
    { id: "l", label: t("settings.fontSizeL") },
    { id: "xl", label: t("settings.fontSizeXl") },
  ];
  const choiceRows = <T extends string>(
    prefix: string,
    options: Array<{ id: T; label: string; disabled?: boolean }>,
    selected: T,
    choose: (id: T) => void,
  ): AttachSheetRowData[] => options.map((option) => ({
    testID: `settings.sheet.${prefix}.${option.id}`,
    label: option.label,
    role: "radio",
    selected: option.id === selected,
    disabled: option.disabled,
    onPress: () => choose(option.id),
  }));

  let sheetTitle = "";
  let sheetSubtitle: string | undefined;
  let rows: AttachSheetRowData[] = [];
  let scroll = false;
  if (sheet === "model") {
    sheetTitle = t("settings.modelPicker");
    rows = choiceRows("model", modelOptions.map(({ id, label, detail, disabled }) => ({ id, label: `${label} · ${detail}`, disabled })), currentModelId, onSelectModel);
    scroll = true;
  } else if (sheet === "theme") {
    sheetTitle = t("settings.theme");
    rows = choiceRows("theme", [
      { id: "light", label: t("settings.themeLight") },
      { id: "dark", label: t("settings.themeDark") },
    ], mode, setMode);
  } else if (sheet === "size") {
    sheetTitle = t("settings.fontSize");
    rows = choiceRows("size", fontScales, fontScaleId, setFontScaleId);
  } else if (sheet === "language") {
    sheetTitle = t("settings.language");
    rows = choiceRows("language", [
      { id: "en", label: t("settings.languageEn") },
      { id: "it", label: t("settings.languageIt") },
    ], locale, (next) => setLocale(next as Locale));
  } else if (sheet === "permissions") {
    sheetTitle = t("settings.permissions");
    sheetSubtitle = t("settings.permissionsSummary");
    rows = [
      { testID: "settings.permission.deviceTools", label: t("settings.deviceTools"), role: "switch", selected: deviceToolsEnabled, onPress: () => onToggleDeviceTools(!deviceToolsEnabled) },
      { testID: "settings.permission.calendarTools", label: t("settings.calendarTools"), role: "switch", selected: calendarToolsEnabled, onPress: () => onToggleCalendarTools(!calendarToolsEnabled) },
    ];
  }

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, backgroundColor: colors.page }}>
      <SettingsHeader title={t("settings.title")} onBack={onBack} backLabel={t("common.back")} />
      <ScrollView
        testID="settings.home.scroll"
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Group title={t("settings.groupAssistant")} colors={colors}>
          <Row testID="settings.home.where" title={t("settings.whereRuns")} value={t("settings.thisPhone")} icon={<Smartphone size={20} color={colors.accent} strokeWidth={1.75} />} colors={colors} />
          <Divider colors={colors} />
          <Row testID="settings.home.model" title={t("settings.modelPicker")} subtitle={model?.label ?? currentModelId} value={model?.detail} icon={<Cpu size={20} color={colors.accent} strokeWidth={1.75} />} onPress={() => setSheet("model")} disabled={modelBusy} colors={colors} />
        </Group>

        <Group title={t("settings.groupAppearance")} colors={colors}>
          <Row testID="settings.home.theme" title={t("settings.theme")} value={mode === "dark" ? t("settings.themeDark") : t("settings.themeLight")} icon={<Moon size={20} color={colors.accent} strokeWidth={1.75} />} onPress={() => setSheet("theme")} colors={colors} />
          <Divider colors={colors} />
          <Row testID="settings.home.fontSize" title={t("settings.fontSize")} value={fontScaleId.toLocaleUpperCase()} icon={<Type size={20} color={colors.accent} strokeWidth={1.75} />} onPress={() => setSheet("size")} colors={colors} />
          <Divider colors={colors} />
          <Row testID="settings.home.language" title={t("settings.language")} value={locale === "it" ? t("settings.languageIt") : t("settings.languageEn")} icon={<Languages size={20} color={colors.accent} strokeWidth={1.75} />} onPress={() => setSheet("language")} colors={colors} />
        </Group>

        <Group title={t("settings.groupPrivacy")} colors={colors}>
          {webToggleProps ? (
            <>
              <Row testID="settings.home.web" title={t("settings.webToggle")} subtitle={t("settings.webWhenAsked")} {...webToggleProps} icon={<Search size={20} color={colors.accent} strokeWidth={1.75} />} colors={colors} />
              <Divider colors={colors} />
            </>
          ) : null}
          <Row testID="settings.home.telemetry" title={t("settings.telemetry")} subtitle={telemetryEnabled ? t("settings.telemetryBodyOn") : t("settings.telemetryBodyOff")} checked={telemetryEnabled} onPress={() => onToggleTelemetry(!telemetryEnabled)} disabled={telemetryBusy} icon={<Activity size={20} color={colors.accent} strokeWidth={1.75} />} colors={colors} />
          <Divider colors={colors} />
          <Row testID="settings.home.permissions" title={t("settings.permissions")} subtitle={t("settings.permissionsSummary")} icon={<ShieldCheck size={20} color={colors.accent} strokeWidth={1.75} />} onPress={() => setSheet("permissions")} colors={colors} />
        </Group>

        <Group title={t("settings.groupEngine")} colors={colors}>
          <Row testID="settings.home.advanced" title={t("settings.advanced")} subtitle={t("settings.advancedSummary")} value={t("settings.advancedCount", { count: 12 })} icon={<SlidersHorizontal size={20} color={colors.accent} strokeWidth={1.75} />} onPress={onOpenAdvanced} colors={colors} />
        </Group>

        <Group title="Kalsa" colors={colors}>
          <View testID="settings.home.kalsa" style={{ minHeight: 72, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm }}>
            <Image source={require("../../assets/icon.png")} accessibilityLabel={t("settings.brandMark")} style={{ width: 40, height: 40, borderRadius: 12 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.headline, { color: colors.ink }]}>Kalsa</Text>
              <Text numberOfLines={1} style={[type.secondary, { color: colors.ink2, marginTop: 2 }]}>{t("settings.brandVersion", { version: appVersion })}</Text>
            </View>
          </View>
        </Group>
      </ScrollView>
      {sheet ? (
        <AttachSheet
          title={sheetTitle}
          subtitle={sheetSubtitle}
          rows={rows}
          colors={colors}
          scroll={scroll}
          primaryActionLabel={t("common.done")}
          onPrimaryAction={() => setSheet(null)}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}
