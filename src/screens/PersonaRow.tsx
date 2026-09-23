import { Pressable, Text, View } from "react-native";

import type { TranslateFn } from "../i18n";
import { isBuiltinPersonaId, type BuiltinPersonaId, type Persona } from "../conversations/PersonasStore";
import { space, type, type DesignColors } from "../theme/design";

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
        <Action
          testID={`personas.action.edit.${persona.id}`}
          label={persona.builtin ? t("personas.duplicate") : t("personas.edit")}
          color={colors.accent}
          onPress={onEdit}
        />
        {canToggleHidden ? (
          <Action
            testID={`personas.action.visibility.${persona.id}`}
            label={hidden ? t("personas.show") : t("personas.hide")}
            color={colors.ink3}
            onPress={() => onToggleHidden(persona.id as BuiltinPersonaId)}
          />
        ) : !persona.builtin ? (
          <Action
            testID={`personas.action.delete.${persona.id}`}
            label={t("personas.delete")}
            color={colors.danger}
            onPress={onDelete}
          />
        ) : null}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line, marginLeft: space.md }} />
    </View>
  );
}
