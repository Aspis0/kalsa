import { useMemo, useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { GlassPanel2 } from "../theme/components";
import { SettingsHeader } from "./SettingsHeader";
import { useLabTheme } from "../ui/labTheme";
import { PairingSession, type PairingSquare } from "../pairing/pairingTransport";
import { PairingManualForm, type PairingFields } from "./PairingManualForm";
import { createDeskPairingFetch } from "../pairing/pairingDeskFetch";
import { chooseRoad } from "../remote/road";
import { irohModulePresent } from "../remote/irohBridge";
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
  const [showManual, setShowManual] = useState(false);
  const [state, setState] = useState<"ready" | "refused" | "waiting" | "door-required">("ready");
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  // A ceremony on this phone announces its weights_bytes, so without a
  // concrete local GGUF there is nothing to pair — the button shows why.
  const phone = declarationForModel(currentModelId);
  const canPair = phone !== null;
  const sessionRef = useRef<PairingSession | null>(null);
  const deskAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // Back or unmount: a desk request still in flight must stop here and
      // shut its tunnel, not finish against a screen that is gone.
      deskAbortRef.current?.abort();
    },
    [],
  );

  /** The one signal every desk request of this screen shares. */
  const deskSignal = () => {
    deskAbortRef.current ??= new AbortController();
    return deskAbortRef.current.signal;
  };

  const update = (key: keyof PairingFields, value: string) => {
    sessionRef.current = null;
    setState("ready");
    setFields((current) => ({ ...current, [key]: value }));
  };

  const run = async (scanned?: PairingSquare) => {
    Keyboard.dismiss();
    if (busy || state === "waiting") return;
    if (!phone) {
      // The disabled button and its reason already say why; logcat still
      // owes the pre-claim stage line every refusal produces.
      logPairingFail("validate", null);
      return;
    }
    if (!isAllowedPairingUrl(fields.doorUrl)) {
      // A fresh install has no door URL yet; say which address is missing
      // instead of folding it into the opaque desk refusal.
      logPairingFail("validate", null);
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
      const square = scanned ?? fields;
      const existing = sessionRef.current;
      const retryingCompletion = existing?.needsCompletionRetry() === true;
      // The desk lane replaces the HTTPS desk only when the square names a
      // node and the native module is there; claim/complete keep the same
      // wire and failure stages either way. This is also what the saved
      // credential records as pairedVia: the road the ceremony rode.
      const useIrohDesk = chooseRoad(square.node, irohModulePresent).road === "iroh";
      const session = retryingCompletion
        ? existing
        : new PairingSession({
            deskUrl: fields.deskUrl,
            square,
            phone,
            fetcher: useIrohDesk ? createDeskPairingFetch(square.node, deskSignal()) : undefined,
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
      // The paired URL, credential, node and pairing road are the active
      // door configuration — the road decides what fallbacks exist later.
      try {
        await savePairingCredential(credential, fields.doorUrl.trim(), {
          node: square.node,
          pairedVia: useIrohDesk ? "iroh" : "https",
        });
      } catch {
        logPairingFail("save", null);
        setState("refused");
        return;
      }
      setState("waiting");
    } catch {
      // The pairing response is deliberately opaque: one refusal sentence for
      // bad input, an unavailable desk, and every server-side rejection. A
      // throw reaching here escaped every named stage and must still leave
      // its one line in logcat.
      logPairingFail("unexpected", null);
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

  const status: { testID: string; text: string; error: boolean } = busy
    ? { testID: "pairing.busy", text: t("pairing.working"), error: false }
    // The reason renders either here (details collapsed) or next to the
    // disabled button inside the form — never both: one placement per view.
    : !canPair && !showManual
      ? { testID: "pairing.model-required", text: t("pairing.modelRequired"), error: true }
      : state === "door-required"
        ? { testID: "pairing.door-required", text: t("pairing.doorRequired"), error: true }
        : state === "refused"
          ? { testID: "pairing.refused", text: t("pairing.refused"), error: true }
          : state === "waiting"
            ? { testID: "pairing.waiting", text: t("pairing.waiting"), error: false }
            : { testID: "pairing.hint", text: t("pairing.scanHint"), error: false };

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 60, backgroundColor: colors.page }}>
      <SettingsHeader title={t("pairing.title")} onBack={onBack} backLabel={t("common.back")} />
      <ScrollView
        testID="pairing.screen.scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 0 }}
      >
        <GlassPanel2 opaque rounded="lg" style={{ padding: space.md, gap: space.md }}>
          <Pressable
            testID="pairing.scan"
            accessibilityRole="button"
            accessibilityLabel={t("pairing.scan")}
            accessibilityState={{ disabled: busy || state === "waiting" }}
            disabled={busy || state === "waiting"}
            onPress={() => {
              // Drop the IME before the camera opens; the scanner lives in
              // its own Modal window (PairingQrScanner), so the app
              // window's keyboard-cropped height can no longer crop it.
              Keyboard.dismiss();
              setScanning(true);
            }}
            style={({ pressed }) => ({
              minHeight: 64,
              borderRadius: radius.button,
              alignItems: "center" as const,
              justifyContent: "center" as const,
              backgroundColor: pressed ? colors.brandDeep : colors.brand,
              opacity: busy || state === "waiting" ? 0.6 : 1,
            })}
          >
            <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("pairing.scan")}</Text>
          </Pressable>
          <Text testID={status.testID} style={[type.secondary, { color: status.error ? colors.danger : colors.ink2 }]}>
            {status.text}
          </Text>
          <Pressable
            testID="pairing.manual"
            accessibilityRole="button"
            accessibilityLabel={t("pairing.manual")}
            accessibilityState={{ expanded: showManual, disabled: busy }}
            disabled={busy}
            onPress={() => setShowManual((open) => !open)}
            style={({ pressed }) => ({
              minHeight: 44,
              borderRadius: radius.button,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center" as const,
              justifyContent: "center" as const,
              backgroundColor: pressed ? colors.surface : "transparent",
            })}
          >
            <Text style={[type.body, { color: colors.ink }]}>
              {showManual ? t("pairing.manualHide") : t("pairing.manual")}
            </Text>
          </Pressable>
          {showManual ? (
            <PairingManualForm
              fields={fields}
              busy={busy}
              waiting={state === "waiting"}
              canPair={canPair}
              diagnosticsEnabled={diagnosticsEnabled}
              onChange={update}
              onToggleDiagnostics={() => setDiagnosticsEnabled((value) => !value)}
              onSubmit={() => void run()}
            />
          ) : null}
        </GlassPanel2>
      </ScrollView>
      {scanning ? (
        <PairingQrScanner onFound={acceptScannedSquare} onCancel={() => setScanning(false)} />
      ) : null}
    </View>
  );
}
