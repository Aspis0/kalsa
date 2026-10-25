import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { EllipsisVertical } from "lucide-react-native";

import type { TranslateFn } from "../i18n";
import { isBuiltinPersonaId, type BuiltinPersonaId, type Persona } from "../conversations/PersonasStore";
import { space, type, type DesignColors } from "../theme/design";
import { AttachSheet, type AttachSheetRowData } from "../ui/shell/AttachSheet";

type Props = {
  persona: Persona;
  active: boolean;
  hidden: boolean;
  colors: DesignColors;
  t: TranslateFn;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleHidden: (id: BuiltinPersonaId) => void;
};

type ActionProps = {
  testID: string;
  label: string;
  color: string;
  onPress: () => void;
};

function Action({ testID, label, color, onPress }: ActionProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space.xxs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={[type.secondary, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function PersonaRow({
  persona,
  active,
  hidden,
  colors,
  t,
  onActivate,
  onEdit,
  onDelete,
  onToggleHidden,
}: Props) {
  const canToggleHidden = persona.builtin && isBuiltinPersonaId(persona.id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const runAndClose = (action: () => void) => () => {
    setActionsOpen(false);
    action();
  };
  const actionRows: AttachSheetRowData[] = persona.builtin
    ? [
        {
          testID: `personas.action.duplicate.${persona.id}`,
          label: t("personas.duplicate"),
          onPress: runAndClose(onEdit),
        },
        ...(canToggleHidden ? [{
          testID: `personas.action.visibility.${persona.id}`,
          label: t(hidden ? "personas.show" : "personas.hide"),
          onPress: runAndClose(() => onToggleHidden(persona.id as BuiltinPersonaId)),
        }] : []),
      ]
    : [
        {
          testID: `personas.action.edit.${persona.id}`,
          label: t("personas.edit"),
          onPress: runAndClose(onEdit),
        },
        {
          testID: `personas.action.delete.${persona.id}`,
          label: t("personas.delete"),
          tone: "danger",
          onPress: runAndClose(onDelete),
        },
      ];
  return (
    <View style={{ opacity: hidden ? 0.55 : 1 }}>
      <View
        style={{
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xxs,
          paddingHorizontal: space.md,
          backgroundColor: active ? colors.tint : colors.surface,
        }}
      >
        <Text numberOfLines={1} style={[type.bodyStrong, { color: colors.ink, flex: 1, minWidth: 0 }]}>
          {persona.name}{active ? ` · ${t("personas.active")}` : ""}{hidden ? ` · ${t("personas.hidden")}` : ""}
        </Text>
        {!hidden ? (
          <Action
            testID={`personas.action.use.${persona.id}`}
            label={active ? t("personas.clear") : t("personas.use")}
            color={colors.accent}
            onPress={onActivate}
          />
        ) : null}
        <Pressable
          testID={`personas.actions.${persona.id}`}
          onPress={() => setActionsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("personas.rowActions", { name: persona.name })}
          style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <EllipsisVertical size={20} color={colors.ink3} strokeWidth={1.75} />
        </Pressable>
      </View>
      {actionsOpen ? (
        <AttachSheet
          title={t("personas.rowActions", { name: persona.name })}
          rows={actionRows}
          colors={colors}
          onClose={() => setActionsOpen(false)}
        />
      ) : null}
      <View style={{ height: 1, backgroundColor: colors.line, marginLeft: space.md }} />
    </View>
  );
}
