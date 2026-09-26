/**
 * The typed half of the pairing screen, behind its disclosure: the two
 * URLs, the square's typed values, the diagnostics switch and Start.
 * `reachable` is deliberately absent — the MAC signs it but nothing ever
 * dials it, and only a scan fills it into the square state.
 */

import { Pressable, Text, TextInput, View } from "react-native";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import type { PairingSquare } from "../pairing/pairingTransport";

export type PairingFields = PairingSquare & { doorUrl: string; deskUrl: string };

type Props = {
  fields: PairingFields;
  busy: boolean;
  waiting: boolean;
  diagnosticsEnabled: boolean;
  onChange: (key: keyof PairingFields, value: string) => void;
  onToggleDiagnostics: () => void;
  onSubmit: () => void;
};

export function PairingManualForm({
  fields,
  busy,
  waiting,
  diagnosticsEnabled,
  onChange,
  onToggleDiagnostics,
  onSubmit,
}: Props) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];

  const inputStyle = {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    paddingHorizontal: space.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    ...type.body,
  };
  const field = (
    key: keyof PairingFields,
    label: string,
    keyboardType: "url" | "default" = "default",
    secureTextEntry = false,
  ) => (
    <View key={key} style={{ gap: space.xs }}>
      <Text style={[type.secondary, { color: colors.ink2 }]}>{label}</Text>
      <TextInput
        testID={`pairing.${key}`}
        accessibilityLabel={label}
        value={fields[key]}
        onChangeText={(value) => onChange(key, value)}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        placeholderTextColor={colors.ink3}
        style={inputStyle}
      />
    </View>
  );

  return (
    <View testID="pairing.manual" style={{ gap: space.md }}>
      <Text style={[type.secondary, { color: colors.ink2 }]}>{t("pairing.debugHint")}</Text>
      {field("doorUrl", t("pairing.doorUrl"), "url")}
      {field("deskUrl", t("pairing.deskUrl"), "url")}
      {field("code", t("pairing.code"), "default", true)}
      {field("nonce", t("pairing.nonce"), "default", true)}
      {field("node", t("pairing.node"))}
      <Pressable
        testID="pairing.diagnostics"
        accessibilityRole="switch"
        accessibilityLabel={t("pairing.diagnostics")}
        accessibilityState={{ checked: diagnosticsEnabled, disabled: busy }}
        disabled={busy}
        onPress={onToggleDiagnostics}
      >
        <Text style={[type.secondary, { color: colors.ink2 }]}>{t("pairing.diagnostics")}</Text>
      </Pressable>
      {waiting ? null : (
        <Pressable
          testID="pairing.submit"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.submit")}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onSubmit}
          style={({ pressed }) => ({
            minHeight: 48,
            borderRadius: radius.button,
            alignItems: "center" as const,
            justifyContent: "center" as const,
            backgroundColor: pressed ? colors.brandDeep : colors.brand,
            opacity: busy ? 0.6 : 1,
          })}
        >
          <Text style={[type.bodyStrong, { color: colors.onBrand }]}>
            {busy ? t("pairing.working") : t("pairing.submit")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
