/**
 * The full-screen mini-app sheet: the controller's chrome
 * (`AppShell.tsx:7214-7252`) around `AskAssistantMiniappRenderer`, which is
 * CALLED, never edited — including the block-action routing
 * (`AppShell.tsx:5346-5362`): `generate_report`, `export_csv` and every
 * unhandled id go through `handleAskAssistantMiniappAction`, whose feedback
 * and errors ride this build's one-slot notice.
 *
 * Two deltas from the controller, both this build's rules:
 *
 * - the close control is a real 48 dp box with a `testID` and an accessible
 *   name (the controller's was a 20 dp glyph on `hitSlop={8}`);
 * - `setAskAssistantDraft` stays the controller's own no-op slot
 *   (`AppShell.tsx:5347`): `miniappActions.ts` never calls it in either
 *   build, so passing a no-op is parity, not an inert affordance — the
 *   renderer answers `requiresAi` actions itself (`miniapp.actionRequiresAi`)
 *   before `onAction` ever fires.
 *
 * Export actions (PNG/JPEG/SVG/JSON) run entirely inside the renderer
 * (capture → write → share sheet) — no host permission this build lacks,
 * and nothing in the sheet is wired to a stub.
 */
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { handleAskAssistantMiniappAction } from "../app/miniappActions";
import { useLocale } from "../i18n";
import { fontFamilies } from "../theme/typography";
import { AskAssistantMiniappRenderer } from "../ui/AskAssistantMiniappRenderer";
import { useLabTheme } from "../ui/labTheme";
import type { AskAssistantMiniapp } from "../domain/askAssistant";

export function HostMiniappSheet({
  miniapp,
  onClose,
  onNoticeText,
}: {
  miniapp: AskAssistantMiniapp;
  onClose: () => void;
  /** The one-slot notice with a rendered string: the action handler speaks
   *  strings, not catalogue keys (`miniappActions.ts`). */
  onNoticeText: (value: string) => void;
}) {
  const { t, locale } = useLocale();
  const { colors, styles } = useLabTheme<any>();
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      testID="miniapp.sheet"
    >
      {/* Unkeyed, like the controller's: the sheet mounts per open and reads
          the live theme, so a font-scale change repaints it in place. */}
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.shell }}>
        <View
          style={{
            alignItems: "center",
            borderBottomColor: colors.line,
            borderBottomWidth: 1,
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingVertical: 4,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: colors.ink,
              flex: 1,
              fontFamily: fontFamilies.bodySemi,
              fontSize: 16,
            }}
          >
            {miniapp.title}
          </Text>
          <Pressable
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              minWidth: 48,
              opacity: pressed ? 0.7 : 1,
            })}
            testID="miniapp.sheet.close"
          >
            <X size={20} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <AskAssistantMiniappRenderer
            colors={colors}
            miniapp={miniapp}
            onAction={(action, active) => {
              void handleAskAssistantMiniappAction(
                action as Record<string, unknown>,
                (active ?? miniapp) as AskAssistantMiniapp,
                {
                  // The controller's own no-op: this handler never writes a
                  // draft in either build (`AppShell.tsx:5347`).
                  setAskAssistantDraft: () => undefined,
                  setFeedback: onNoticeText,
                  setMobileError: (value) => onNoticeText(`⚠️ ${value}`),
                  locale,
                },
              );
            }}
            styles={styles}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
