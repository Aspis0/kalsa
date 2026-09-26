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
import { chooseRoad, isValidNodeHex } from "../remote/road";
import { irohModulePresent } from "../remote/irohBridge";
import { logPairingFail } from "../pairing/pairingFailLog";
import {
  savePairingCredential,
  type SavedPairingCredential,
} from "../pairing/pairingCredentialStore";
import {
  pairedPropsProbe,
  pollForAllowance,
  type ConfirmationPhase,
} from "../pairing/pairingConfirmation";
import { bytesToHex } from "../pairing/sha256";
import { isAllowedPairingUrl, pairingUrlPrefill } from "../pairing/pairingUrls";
import type { PairingPhoneDeclaration } from "../pairing/pairingWire";
import { PairingQrScanner } from "./PairingQrScanner";

type Props = {
  initialDoorUrl: string;
  currentModelId: string;
  onBack: () => void;
  /** Leaves for the chat — passed when pairing was opened from settings. */
  onDone?: () => void;
};

/** The desk's allow-answer poll: one /props every 2 s, up to 3 minutes. */
const CONFIRM_POLL_INTERVAL_MS = 2_000;
const CONFIRM_POLL_CAP_MS = 180_000;
/** Consecutive transport failures before the unreachable line shows. */
const CONFIRM_UNREACHABLE_AFTER = 3;

function declarationForModel(modelId: string): PairingPhoneDeclaration {
  const model = MODEL_REGISTRY.find((entry) => entry.id === modelId);
  if (
    !model ||
    !model.file ||
    !Number.isSafeInteger(model.sizeBytes) ||
    model.sizeBytes <= 0
  ) {
    // The desk's final contract (kalsa-brain): no model selected announces
    // itself with the zero declaration — same wire shape, canonical bytes,
    // and the phone is still battery powered.
    return {
      weights_bytes: 0,
      parameters: null,
      measured_tokens_per_second: null,
      battery_powered: true,
    };
  }
  return {
    weights_bytes: model.sizeBytes,
    // The catalog has no parameter or throughput metadata; do not infer them
    // from a model name.
    parameters: null,
    measured_tokens_per_second: null,
    battery_powered: true,
  };
}

export function PairingScreen({ initialDoorUrl, currentModelId, onBack, onDone }: Props) {
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
    tailnet: "",
  });
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [state, setState] = useState<"ready" | "refused" | "waiting" | "paired" | "not-confirmed">("ready");
  const [confirmPhase, setConfirmPhase] = useState<ConfirmationPhase>({ phase: "waiting" });
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  // The typed address is Start's one blocking input: without a door the
  // ceremony cannot even name who to ask. (A missing phone model is not a
  // block — the zero declaration says "none" on the wire.)
  const doorReady = isAllowedPairingUrl(fields.doorUrl);
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

  /** The saved credential as the confirmation poll reads it. */
  const pairedRef = useRef<SavedPairingCredential | null>(null);

  const startConfirmation = (paired: SavedPairingCredential) => {
    const signal = deskSignal();
    void pollForAllowance({
      probe: pairedPropsProbe(paired, signal),
      signal,
      intervalMs: CONFIRM_POLL_INTERVAL_MS,
      capMs: CONFIRM_POLL_CAP_MS,
      unreachableAfter: CONFIRM_UNREACHABLE_AFTER,
      onPhase: setConfirmPhase,
    }).then((outcome) => {
      if (outcome.result === "aborted") return;
      if (outcome.result === "paired") {
        setState("paired");
        return;
      }
      // The cap is the only thing that can end a 401-only poll: refused,
      // revoked and still-pending all answer 401 to the phone.
      logPairingFail("confirm_timeout", null);
      setState("not-confirmed");
    });
  };

  const retryConfirmation = () => {
    const paired = pairedRef.current;
    if (!paired) return;
    setConfirmPhase({ phase: "waiting" });
    setState("waiting");
    startConfirmation(paired);
  };

  const update = (key: keyof PairingFields, value: string) => {
    sessionRef.current = null;
    setState("ready");
    setFields((current) => ({ ...current, [key]: value }));
  };

  const run = async (scanned?: PairingSquare) => {
    Keyboard.dismiss();
    if (busy || state === "waiting") return;
    // A scanned tailnet names both addresses itself (door = the URL, desk =
    // same origin on :8443, through the same prefill both typed fields use);
    // otherwise the typed fields are the addresses.
    const scannedUrls = scanned?.tailnet ? pairingUrlPrefill(scanned.tailnet) : null;
    const doorUrl = scannedUrls ? scannedUrls.doorUrl : fields.doorUrl;
    const deskUrl = scannedUrls ? scannedUrls.deskUrl : fields.deskUrl;
    if (!isAllowedPairingUrl(doorUrl)) {
      // A fresh install has no door URL yet: the reason line already shows
      // it (button disabled beside it); logcat still owes the stage line.
      logPairingFail("validate", null);
      return;
    }
    if (!isAllowedPairingUrl(deskUrl)) {
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
            deskUrl,
            square,
            phone: declarationForModel(currentModelId),
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
        await savePairingCredential(credential, doorUrl.trim(), {
          node: square.node,
          pairedVia: useIrohDesk ? "iroh" : "https",
        });
      } catch {
        logPairingFail("save", null);
        setState("refused");
        return;
      }
      const paired: SavedPairingCredential = {
        credential: bytesToHex(credential),
        doorUrl: doorUrl.trim(),
        node: isValidNodeHex(square.node) ? square.node : null,
        pairedVia: useIrohDesk ? "iroh" : "https",
      };
      pairedRef.current = paired;
      setState("waiting");
      startConfirmation(paired);
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
    const scannedUrls = square.tailnet ? pairingUrlPrefill(square.tailnet) : null;
    setFields((current) => ({ ...current, ...square, ...(scannedUrls ?? {}) }));
    void run(square);
  };

  const status: { testID: string; text: string; error: boolean } = busy
    ? { testID: "pairing.busy", text: t("pairing.working"), error: false }
    // The reason renders either here (details collapsed) or next to the
    // disabled button inside the form — never both: one placement per view.
    : !doorReady && !showManual
      ? { testID: "pairing.door-required", text: t("pairing.doorRequired"), error: true }
      : state === "refused"
        ? { testID: "pairing.refused", text: t("pairing.refused"), error: true }
        : state === "paired"
          ? { testID: "pairing.paired", text: t("pairing.paired"), error: false }
          : state === "not-confirmed"
            ? { testID: "pairing.notConfirmed", text: t("pairing.notConfirmed"), error: true }
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
          {state === "waiting" && confirmPhase.phase === "unreachable" ? (
            <Text testID="pairing.unreachable" style={[type.secondary, { color: colors.danger }]}>
              {t("pairing.unreachablePoll")}
            </Text>
          ) : null}
          {state === "paired" ? (
            <Pressable
              testID="pairing.paired.done"
              accessibilityRole="button"
              accessibilityLabel={t("pairing.goToChat")}
              onPress={() => onDone?.()}
              style={({ pressed }) => ({
                minHeight: 48,
                borderRadius: radius.button,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                backgroundColor: pressed ? colors.brandDeep : colors.brand,
              })}
            >
              <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("pairing.goToChat")}</Text>
            </Pressable>
          ) : state === "not-confirmed" ? (
            <Pressable
              testID="pairing.retry"
              accessibilityRole="button"
              accessibilityLabel={t("pairing.retry")}
              onPress={retryConfirmation}
              style={({ pressed }) => ({
                minHeight: 48,
                borderRadius: radius.button,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                backgroundColor: pressed ? colors.surface : "transparent",
              })}
            >
              <Text style={[type.bodyStrong, { color: colors.ink }]}>{t("pairing.retry")}</Text>
            </Pressable>
          ) : null}
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
              doorReady={doorReady}
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
