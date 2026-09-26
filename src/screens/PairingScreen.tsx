import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { GlassPanel2 } from "../theme/components";
import { SettingsHeader } from "./SettingsHeader";
import { useLabTheme } from "../ui/labTheme";
import { PairingSession, type PairingSquare } from "../pairing/pairingTransport";
import { logPairingFail } from "../pairing/pairingFailLog";
import { savePairingCredential } from "../pairing/pairingCredentialStore";
import { isAllowedPairingUrl, pairingUrlPrefill } from "../pairing/pairingUrls";
import type { PairingPhoneDeclaration } from "../pairing/pairingWire";
import { PairingQrScanner } from "./PairingQrScanner";

type Props = {
  initialDoorUrl: string;
  currentModelId: string;
  onBack: () => void;
};

type PairingFields = PairingSquare & { doorUrl: string; deskUrl: string };

function declarationForModel(modelId: string): PairingPhoneDeclaration | null {
  const model = MODEL_REGISTRY.find((entry) => entry.id === modelId);
  if (
    !model ||
    !model.file ||
    !Number.isSafeInteger(model.sizeBytes) ||
    model.sizeBytes <= 0
  ) return null;
  return {
    weights_bytes: model.sizeBytes,
    // The catalog has no parameter or throughput metadata; do not infer them
    // from a model name.
    parameters: null,
    measured_tokens_per_second: null,
    battery_powered: true,
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
  const [scanning, setScanning] = useState(false);
  const [state, setState] = useState<"ready" | "refused" | "waiting" | "model-required" | "door-required">("ready");
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const sessionRef = useRef<PairingSession | null>(null);

  const update = (key: keyof PairingFields, value: string) => {
    sessionRef.current = null;
    setState("ready");
    setFields((current) => ({ ...current, [key]: value }));
  };

  const run = async (scanned?: PairingSquare) => {
    Keyboard.dismiss();
    if (busy || state === "waiting") return;
    const phone = declarationForModel(currentModelId);
    if (!phone) {
      setState("model-required");
      return;
    }
    if (!isAllowedPairingUrl(fields.doorUrl)) {
      // A fresh install has no door URL yet; say which address is missing
      // instead of folding it into the opaque desk refusal.
      setState("door-required");
      return;
    }
    if (!isAllowedPairingUrl(fields.deskUrl)) {
      logPairingFail("validate", null);
      setState("refused");
      return;
    }
    setBusy(true);
    try {
      // A scanned square is a fresh square: it abandons a session holding a
      // completion retry for the previous one. Only a run that passed its
      // guards gets here, so a rejected scan never drops that session.
      if (scanned) sessionRef.current = null;
      const existing = sessionRef.current;
      const retryingCompletion = existing?.needsCompletionRetry() === true;
      const session = retryingCompletion
        ? existing
        : new PairingSession({
            deskUrl: fields.deskUrl,
            square: scanned ?? fields,
            phone,
            onDiagnostic: diagnosticsEnabled
              ? (record) => console.log("KALSA_PAIRING_DIAGNOSTIC", JSON.stringify(record))
              : undefined,
          });
      sessionRef.current = session;
      const credential = retryingCompletion
        ? await session.retryComplete()
        : await session.begin();
      if (!credential) {
        setState("refused");
        return;
      }
      // The paired URL and credential are the active door configuration.
      try {
        await savePairingCredential(credential, fields.doorUrl.trim());
      } catch {
        logPairingFail("save", null);
        setState("refused");
        return;
      }
      setState("waiting");
    } catch {
      // The pairing response is deliberately opaque: one refusal sentence for
      // bad input, an unavailable desk, and every server-side rejection.
      setState("refused");
    } finally {
      setBusy(false);
    }
  };

  // This handler preempts nothing: run() checks `busy`/`state` from this same
  // committed render before it touches the session, so a rejected scan
  // leaves a pending completion retry intact.
  const acceptScannedSquare = (square: PairingSquare) => {
    setScanning(false);
    setFields((current) => ({ ...current, ...square }));
    void run(square);
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
          <Pressable
            testID="pairing.scan"
            accessibilityRole="button"
            accessibilityLabel={t("pairing.scan")}
            accessibilityState={{ disabled: busy || state === "waiting" }}
            disabled={busy || state === "waiting"}
            onPress={() => {
              // The camera must mount with the keyboard already down: a hide
              // event that lands after CameraView takes the screen is lost,
              // and the Jelly keeps the adjustResize window at its keyboard-
              // cropped height (the half screen seen on the road run).
              Keyboard.dismiss();
              setScanning(true);
            }}
            style={({ pressed }) => ({ minHeight: 48, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.brandDeep : colors.brand, opacity: busy || state === "waiting" ? 0.6 : 1 })}
          >
            <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("pairing.scan")}</Text>
          </Pressable>
          {field("doorUrl", t("pairing.doorUrl"), "url")}
          {field("deskUrl", t("pairing.deskUrl"), "url")}
          {field("reachable", t("pairing.reachable"), "url")}
          {field("code", t("pairing.code"), "default", true)}
          {field("nonce", t("pairing.nonce"), "default", true)}
          {field("node", t("pairing.node"))}
          <Pressable
            testID="pairing.diagnostics"
            accessibilityRole="switch"
            accessibilityLabel={t("pairing.diagnostics")}
            accessibilityState={{ checked: diagnosticsEnabled, disabled: busy }}
            disabled={busy}
            onPress={() => setDiagnosticsEnabled((value) => !value)}
          >
            <Text style={[type.secondary, { color: colors.ink2 }]}>{t("pairing.diagnostics")}</Text>
          </Pressable>
          {state === "model-required" ? (
            <Text testID="pairing.model-required" style={[type.secondary, { color: colors.danger }]}>
              {t("pairing.modelRequired")}
            </Text>
          ) : null}
          {state === "door-required" ? (
            <Text testID="pairing.door-required" style={[type.secondary, { color: colors.danger }]}>
              {t("pairing.doorRequired")}
            </Text>
          ) : null}
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
      {scanning ? (
        <PairingQrScanner onFound={acceptScannedSquare} onCancel={() => setScanning(false)} />
      ) : null}
    </View>
  );
}
