/**
 * The staged attachments as §2.7's chip row: a label with the file's name
 * inside it — *"Reading from fisica.pdf"* — never the bare filename, because
 * a chip with no label is a rebus (`docs/DESIGN.md` §2.7). The text itself
 * is decided in `composerState` (`AttachmentView`); this file draws it and
 * the remove control: a real 48 dp box per chip, never the controller's
 * 18×18 `hitSlop={8}` X (`AiChatPage.tsx:4273`).
 *
 * The optional `job` is the live PDF conversion's status row (`PdfToImages`),
 * rendered in the same band so the row's height is ONE number.
 */
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { X } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { radius, spacing, type, type DesignColors } from "../../theme/design";
import type { AttachmentView } from "./composerState";
import { COMPOSER_ATTACHMENTS_HEIGHT } from "./shellGeometry";

export interface ComposerAttachmentsProps {
  chips: readonly AttachmentView[];
  /** Drop the row at this index — the chips keep the rows' order. */
  onRemove: (index: number) => void;
  /** The conversion status line, drawn above the chips when present. */
  job?: ReactNode;
  colors: DesignColors;
}

export function ComposerAttachments({
  chips,
  onRemove,
  job,
  colors,
}: ComposerAttachmentsProps) {
  const { t } = useLocale();
  return (
    <View testID="shell.composer.attachments" style={{ gap: spacing.xs }}>
      {job ? <View style={{ paddingHorizontal: spacing.md }}>{job}</View> : null}
      {chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.md }}
        >
          {chips.map((chip, index) => (
            <View
              key={`${chip.params.name}-${index}`}
              accessible
              accessibilityLabel={t(chip.key, chip.params)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                overflow: "hidden",
                maxHeight: COMPOSER_ATTACHMENTS_HEIGHT,
              }}
            >
              <Text
                numberOfLines={1}
                style={[
                  type.meta,
                  { color: colors.ink, paddingHorizontal: spacing.sm, maxWidth: 220 },
                ]}
              >
                {t(chip.key, chip.params)}
              </Text>
              <Pressable
                testID={`shell.composer.attachment.remove.${index}`}
                accessibilityRole="button"
                accessibilityLabel={t("chat.a11yRemoveAttachment")}
                onPress={() => onRemove(index)}
                style={{
                  width: COMPOSER_ATTACHMENTS_HEIGHT,
                  height: COMPOSER_ATTACHMENTS_HEIGHT,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} color={colors.silence} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
