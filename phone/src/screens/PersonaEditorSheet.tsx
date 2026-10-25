import { Text, TextInput, View } from "react-native";

import type { TranslateFn } from "../i18n";
import { PERSONA_INSTRUCTIONS_CAP } from "../conversations/PersonasStore";
import { radius, space, type, type DesignColors } from "../theme/design";
import { AttachSheet } from "../ui/shell/AttachSheet";

type Props = {
  editor: PersonaEditorDraft;
  notice: string;
  colors: DesignColors;
  t: TranslateFn;
  onChange: (editor: PersonaEditorDraft) => void;
  onSave: () => void;
  onClose: () => void;
};

export type PersonaEditorDraft = {
  id: string;
  name: string;
  instructions: string;
  builtinSource?: boolean;
};

export function PersonaEditorSheet({
  editor,
  notice,
  colors,
  t,
  onChange,
  onSave,
  onClose,
}: Props) {
  const remaining = PERSONA_INSTRUCTIONS_CAP - editor.instructions.length;
  return (
    <AttachSheet
      rows={[]}
      colors={colors}
      title={t(editor.builtinSource ? "personas.create" : "personas.edit")}
      primaryActionLabel={t("common.save")}
      onPrimaryAction={onSave}
      onClose={onClose}
      scroll
    >
      <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
        <Text style={[type.secondary, { color: colors.ink2 }]}>{t("personas.name")}</Text>
        <TextInput
          value={editor.name}
          onChangeText={(name) => onChange({ ...editor, name })}
          placeholder={t("personas.namePlaceholder")}
          placeholderTextColor={colors.ink3}
          accessibilityLabel={t("personas.name")}
          style={{
            ...type.body,
            minHeight: 52,
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.field,
            paddingHorizontal: space.md,
          }}
        />
        <Text style={[type.secondary, { color: colors.ink2, marginTop: space.xs }]}>
          {t("personas.instructions")}
        </Text>
        <TextInput
          value={editor.instructions}
          onChangeText={(instructions) => onChange({
            ...editor,
            instructions: instructions.slice(0, PERSONA_INSTRUCTIONS_CAP),
          })}
          placeholder={t("personas.instructionsPlaceholder")}
          placeholderTextColor={colors.ink3}
          multiline
          textAlignVertical="top"
          accessibilityLabel={t("personas.instructions")}
          style={{
            ...type.body,
            minHeight: 160,
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.field,
            padding: space.md,
          }}
        />
        <Text style={[type.secondary, { color: colors.ink3 }]}>
          {t("personas.capHint", { max: PERSONA_INSTRUCTIONS_CAP })}
          {remaining < 200 ? ` (${remaining})` : ""}
        </Text>
        {notice ? (
          <Text style={[type.secondary, { color: colors.danger }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
      </View>
    </AttachSheet>
  );
}
