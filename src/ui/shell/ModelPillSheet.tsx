/**
 * The strip pill's sheet: the where-choices (when a usable pairing makes one
 * real, `modelBarChoices.ts`) over the model's own status and battery detail.
 * Draw-only — the rows arrive as data and the status view from the host; the
 * rows are the attach sheet's own `SheetRow`, so the two sheets cannot drift
 * apart on touch size or radio state.
 */
import { Modal, Pressable, Text, View } from "react-native";
import { useLocale } from "../../i18n";
import { e2, modes, spacing, type, type ThemeMode } from "../../theme/design";
import { SheetRow, type AttachSheetRowData } from "./AttachSheet";
import { SheetGrabber } from "./SheetGrabber";
import { ModelBar, type ModelBarView } from "./ModelBar";

/** The row as this sheet draws it: the switch, then the sheet's own
 *  dismissal — a refusal has already spoken through the one-slot notice, and
 *  a Modal would hide it if the sheet stayed up. */
function dismissOnChoice(row: AttachSheetRowData, onClose: () => void): AttachSheetRowData {
  return {
    ...row,
    onPress: () => {
      row.onPress();
      onClose();
    },
  };
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
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
                    row={dismissOnChoice(row, onClose)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text style={[type.secondary, { color: colors.ink3, marginTop: spacing.xs }]}>
            {t("shell.model.statusTitle")}
          </Text>
          {view ? <ModelBar view={view} mode={mode} onRetryPress={onRetryPress} /> : null}
        </View>
      </View>
    </Modal>
  );
}
