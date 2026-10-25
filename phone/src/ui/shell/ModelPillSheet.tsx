/**
 * The strip pill's sheet: the where-choices (when a usable pairing makes one
 * real, `modelBarChoices.ts`) over the model's own status and battery detail.
 * Draw-only — the rows arrive as data and the status view from the host; the
 * rows are the attach sheet's own `SheetRow`, so the two sheets cannot drift
 * apart on touch size or radio state.
 */
import { useCallback, useEffect, useRef } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useLocale } from "../../i18n";
import { e2, modes, spacing, type, type ThemeMode } from "../../theme/design";
import { SheetRow, type AttachSheetRowData } from "./AttachSheet";
import { SheetGrabber } from "./SheetGrabber";
import { ModelBar, type ModelBarView } from "./ModelBar";

/** The row as this sheet draws it: its action runs once the sheet is gone. A
 *  switch that does not take speaks through the one-slot notice, and a
 *  download or a regen/stream Alert must not be presented over the Modal. */
function dismissOnChoice(
  row: AttachSheetRowData,
  closeThen: (run: () => void) => void,
): AttachSheetRowData {
  return { ...row, onPress: () => closeThen(row.onPress) };
}

export function ModelPillSheet({
  visible,
  modelName,
  mode,
  view,
  rows = [],
  onRetryPress,
  onClose,
}: {
  visible: boolean;
  modelName: string;
  mode: ThemeMode;
  view?: ModelBarView;
  /** Empty when only one place can answer: the sheet shows status alone. */
  rows?: readonly AttachSheetRowData[];
  onRetryPress?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const colors = modes[mode];
  // A press queued behind the close. An Alert raised while this Modal is still
  // on screen can fail to present on iOS with no callback (the reported stuck
  // download), so on iOS the action waits for the Modal's onDismiss.
  const afterDismiss = useRef<(() => void) | null>(null);
  const closeThen = (run: () => void) => {
    onClose();
    // Android fires no onDismiss: the action runs right after the close, without
    // waiting for the Modal to go.
    if (Platform.OS === "ios") afterDismiss.current = run;
    else run();
  };
  const runPending = useCallback(() => {
    const run = afterDismiss.current;
    afterDismiss.current = null;
    run?.();
  }, []);
  // Whether the sheet is up now. A dismissal that arrives while it is up is a
  // late one from an earlier presentation, and it must not drain a press queued
  // after the re-open.
  const shownRef = useRef(visible);
  useEffect(() => {
    shownRef.current = visible;
    // A sheet that opens again drops an action its last dismissal never ran.
    if (visible) afterDismiss.current = null;
  }, [visible]);
  const onModalDismiss = useCallback(() => {
    if (!shownRef.current) runPending();
  }, [runPending]);
  // A sheet that leaves the screen runs its pending action: the Modal it
  // waited for is gone with it.
  useEffect(() => () => runPending(), [runPending]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={onModalDismiss}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }} testID="shell.modelSheet">
        <Pressable
          testID="shell.modelSheet.backdrop"
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.28)" }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 0,
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.lg,
            ...e2,
          }}
        >
          <SheetGrabber colors={colors} testID="shell.modelSheet.grabber" marginBottom={spacing.md} />
          <Text style={[type.title, { color: colors.ink }]}>{modelName}</Text>
          {rows.length > 0 ? (
            <>
              <Text style={[type.secondary, { color: colors.ink3, marginTop: spacing.xs }]}>
                {t("settings.whereRuns")}
              </Text>
              <View style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
                {rows.map((row) => (
                  <SheetRow
                    key={row.testID}
                    colors={colors}
                    row={dismissOnChoice(row, closeThen)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text style={[type.secondary, { color: colors.ink3, marginTop: spacing.xs }]}>
            {t("shell.model.statusTitle")}
          </Text>
          {view ? (
            <ModelBar
              view={view}
              mode={mode}
              onRetryPress={onRetryPress ? () => closeThen(onRetryPress) : undefined}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
