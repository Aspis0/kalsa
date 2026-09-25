import { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Linking, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { parsePairingQr } from "../pairing/pairingQr";
import type { PairingSquare } from "../pairing/pairingTransport";

type Props = {
  onFound: (square: PairingSquare) => void;
  onCancel: () => void;
};

/** Live QR camera for the pairing square; emits parsed squares, keeps scanning on parse errors. */
export function PairingQrScanner({ onFound, onCancel }: Props) {
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, recheckPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const accepted = useRef(false);

  useEffect(() => {
    if (permission?.status === "undetermined") void requestPermission();
  }, [permission?.status, requestPermission]);

  // A grant made in Settings never reaches a mounted permission hook; the
  // next foreground re-reads the status so the camera wakes in place.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void recheckPermission();
    });
    return () => subscription.remove();
  }, [recheckPermission]);

  // Hardware back must leave the scanner, not the whole PairingScreen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  const handleScanned = ({ data }: { data: string }) => {
    if (accepted.current) return;
    const parsed = parsePairingQr(data);
    if (!parsed.ok) {
      setError(t(`pairing.scanErrors.${parsed.error}`));
      return;
    }
    // One accepted square per scanner lifetime: the parent drops the
    // ceremony into its own flow from here, so later frames must not
    // restart it.
    accepted.current = true;
    onFound(parsed.square);
  };

  const buttonStyle = {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.button,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: space.md,
  };
  const granted = permission?.granted === true;
  const denied = permission?.status === "denied";
  const canAskAgain = permission?.canAskAgain === true;

  return (
    <View
      testID="pairing.scanner"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 70, backgroundColor: "#000" }}
    >
      {granted ? (
        <CameraView
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleScanned}
        />
      ) : null}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: space.md,
          paddingBottom: insets.bottom + space.md,
          gap: space.sm,
        }}
      >
        {granted ? (
          <Text testID="pairing.scan.caution" style={[type.secondary, { color: "#fff" }]}>
            {t("pairing.scanCaution")}
          </Text>
        ) : null}
        {error ? (
          <Text testID="pairing.scan.error" style={[type.secondary, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {denied ? (
          <>
            <Text testID="pairing.scan.denied" style={[type.secondary, { color: "#fff" }]}>
              {t("pairing.scanDenied")}
            </Text>
            {canAskAgain ? (
              <Pressable
                testID="pairing.scan.allow"
                accessibilityRole="button"
                onPress={() => void requestPermission()}
                style={buttonStyle}
              >
                <Text style={[type.bodyStrong, { color: "#fff" }]}>{t("pairing.scanAllow")}</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="pairing.scan.openSettings"
                accessibilityRole="button"
                onPress={() => void Linking.openSettings()}
                style={buttonStyle}
              >
                <Text style={[type.bodyStrong, { color: "#fff" }]}>{t("pairing.scanOpenSettings")}</Text>
              </Pressable>
            )}
          </>
        ) : null}
        <Pressable
          testID="pairing.scan.cancel"
          accessibilityRole="button"
          onPress={onCancel}
          style={buttonStyle}
        >
          <Text style={[type.bodyStrong, { color: "#fff" }]}>{t("common.cancel")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
