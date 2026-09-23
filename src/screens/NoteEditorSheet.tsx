import { Pressable, Text, TextInput, View } from "react-native";

import type { TranslateFn } from "../i18n";
import { radius, space, type, type DesignColors } from "../theme/design";
import { AttachSheet } from "../ui/shell/AttachSheet";

type Props = {
  title: string;
  draft: string;
  notice: string;
  hasSavedNote: boolean;
  colors: DesignColors;
  t: TranslateFn;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function NoteEditorSheet({
  title,
  draft,
  notice,
  hasSavedNote,
  colors,
  t,
  onDraftChange,
  onSave,
  onExport,
  onDelete,
  onClose,
}: Props) {
  return (
    <AttachSheet
      rows={[]}
      colors={colors}
      title={title}
      primaryActionLabel={t("common.save")}
      onPrimaryAction={onSave}
      onClose={onClose}
      scroll
    >
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          placeholder={t("notes.bodyPlaceholder")}
          placeholderTextColor={colors.ink3}
          multiline
          textAlignVertical="top"
          accessibilityLabel={t("notes.edit")}
          style={{
            ...type.body,
            color: colors.ink,
            minHeight: 220,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.field,
            padding: space.md,
            backgroundColor: colors.surface,
          }}
        />
        {notice ? (
          <Text style={[type.secondary, { color: colors.danger }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          {hasSavedNote ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t("notes.delete")}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: space.sm,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Text style={[type.body, { color: colors.danger }]}>{t("notes.delete")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onExport}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel={t("notes.export")}
            accessibilityState={{ disabled: !draft.trim() }}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: space.sm,
              opacity: !draft.trim() ? 0.45 : pressed ? 0.65 : 1,
            })}
          >
            <Text style={[type.body, { color: colors.accent }]}>{t("notes.export")}</Text>
          </Pressable>
        </View>
      </View>
    </AttachSheet>
  );
}
