import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { GlassPanel2 } from "../theme/components";
import { SettingsHeader } from "./SettingsHeader";
import { useLabTheme } from "../ui/labTheme";
import { PairingSession, type PairingSquare } from "../pairing/pairingTransport";
import { savePairingCredential } from "../pairing/pairingCredentialStore";
import { isAllowedPairingUrl, pairingUrlPrefill } from "../pairing/pairingUrls";
import type { PairingPhoneDeclaration } from "../pairing/pairingWire";

type Props = {
  initialDoorUrl: string;
  currentModelId: string;
  onBack: () => void;
};

type PairingFields = PairingSquare & { doorUrl: string; deskUrl: string };

function declarationForModel(modelId: string): PairingPhoneDeclaration {
  const model = MODEL_REGISTRY.find((entry) => entry.id === modelId);
  return {
    weights_bytes: model?.sizeBytes ?? 0,
    // The catalog has no parameter, throughput, or current battery facts;
    // those fields stay null instead of being inferred from a model name.
    parameters: null,
    measured_tokens_per_second: null,
    battery_powered: null,
  };
}

export function PairingScreen({ initialDoorUrl, currentModelId, onBack }: Props) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const prefill = useMemo(() => pairingUrlPrefill(initialDoorUrl), [initialDoorUrl]);
  const [fields, setFields] = useState<PairingFields>({
    ...prefill,
    reachable: "",
    code: "",
    nonce: "",
    node: "",
  });
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"ready" | "refused" | "waiting">("ready");
  const sessionRef = useRef<PairingSession | null>(null);

  const update = (key: keyof PairingFields, value: string) => {
    sessionRef.current = null;
    setState("ready");
    setFields((current) => ({ ...current, [key]: value }));
  };

  const run = async () => {
    if (busy || state === "waiting") return;
    if (
      !isAllowedPairingUrl(fields.doorUrl) ||
      !isAllowedPairingUrl(fields.deskUrl)
    ) {
      setState("refused");
      return;
    }
    setBusy(true);
    try {
      const existing = sessionRef.current;
      const retryingCompletion = existing?.needsCompletionRetry() === true;
      const session = retryingCompletion
        ? existing
        : new PairingSession({
            deskUrl: fields.deskUrl,
            square: {
              reachable: fields.reachable,
              code: fields.code,
              nonce: fields.nonce,
              node: fields.node,
            },
            phone: declarationForModel(currentModelId),
          });
      sessionRef.current = session;
      const credential = retryingCompletion
        ? await session.retryComplete()
        : await session.begin();
      if (!credential) {
        setState("refused");
        return;
      }
      // Save for a later remote-mode integration; this screen does not probe
      // or stream to the door after the pairing desk returns the seal.
      await savePairingCredential(credential, fields.doorUrl.trim());
      setState("waiting");
    } catch {
      // The pairing response is deliberately opaque: one refusal sentence for
      // bad input, an unavailable desk, and every server-side rejection.
      setState("refused");
    } finally {
      setBusy(false);
    }
  };

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
        onChangeText={(value) => update(key, value)}
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
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 60, backgroundColor: colors.page }}>
      <SettingsHeader title={t("pairing.title")} onBack={onBack} backLabel={t("common.back")} />
      <ScrollView
        testID="pairing.screen.scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 0 }}
      >
        <GlassPanel2 opaque rounded="lg" style={{ padding: space.md, gap: space.md }}>
          <Text style={[type.secondary, { color: colors.ink2 }]}>{t("pairing.debugHint")}</Text>
          {field("doorUrl", t("pairing.doorUrl"), "url")}
          {field("deskUrl", t("pairing.deskUrl"), "url")}
          {field("reachable", t("pairing.reachable"), "url")}
          {field("code", t("pairing.code"), "default", true)}
          {field("nonce", t("pairing.nonce"), "default", true)}
          {field("node", t("pairing.node"))}
          {state === "refused" ? (
            <Text testID="pairing.refused" style={[type.secondary, { color: colors.danger }]}>
              {t("pairing.refused")}
            </Text>
          ) : null}
          {state === "waiting" ? (
            <Text testID="pairing.waiting" style={[type.bodyStrong, { color: colors.ink }]}>
              {t("pairing.waiting")}
            </Text>
          ) : null}
          {state !== "waiting" ? (
            <Pressable
              testID="pairing.submit"
              accessibilityRole="button"
              accessibilityLabel={t("pairing.submit")}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void run()}
              style={({ pressed }) => ({ minHeight: 48, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.brandDeep : colors.brand, opacity: busy ? 0.6 : 1 })}
            >
              <Text style={[type.bodyStrong, { color: colors.onBrand }]}>
                {busy ? t("pairing.working") : t("pairing.submit")}
              </Text>
            </Pressable>
          ) : null}
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}
