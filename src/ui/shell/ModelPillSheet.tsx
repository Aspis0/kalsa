/** Model readiness and battery detail opened from the strip's model pill. */
import { Modal, Pressable, Text, View } from "react-native";
import { useLocale } from "../../i18n";
import { e2, modes, spacing, type, type ThemeMode } from "../../theme/design";
import { SheetGrabber } from "./SheetGrabber";
import { ModelBar, type ModelBarView } from "./ModelBar";

export function ModelPillSheet({
  visible,
  modelName,
  mode,
  view,
  onRetryPress,
  onClose,
}: {
  visible: boolean;
  modelName: string;
  mode: ThemeMode;
  view?: ModelBarView;
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
          <Text style={[type.secondary, { color: colors.ink3, marginTop: spacing.xs }]}>
            {t("shell.model.statusTitle")}
          </Text>
          {view ? <ModelBar view={view} mode={mode} onRetryPress={onRetryPress} /> : null}
        </View>
      </View>
    </Modal>
  );
}
