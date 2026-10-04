/**
 * Who is in the room — host, phones, and Kalsa — and the reader's own name
 * beside them: a chip that opens the small form, and the room's refusal in
 * the household's words when the name it was given is one it will not take.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocale } from "../../i18n";
import { families, radius, space, type DesignColors } from "../../theme/design";
import type { RoomMember } from "../../room/roomWire";
import { noteLine } from "./roomNotes";

type Props = {
  colors: DesignColors;
  members: RoomMember[];
  you: number;
  nameErrorCode: string | null;
  onSetName: (name: string) => void;
};

export function RoomPeople({ colors, members, you, nameErrorCode, onSetName }: Props) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<string | null>(null);
  const me = members.find((member) => member.memberId === you);
  const myName = me?.name === "" || me === undefined ? t("room.defaultHostName") : me.name;
  const refusal = noteLine(t, nameErrorCode);

  const save = (): void => {
    const name = draft?.trim() ?? "";
    setDraft(null);
    if (name !== "") onSetName(name);
  };

  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.xs }}>
      <Text style={{ color: colors.ink3, fontFamily: families.sansBold, fontSize: 11, letterSpacing: 0.9 }}>
        {t("room.members").toUpperCase()}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space.xxs }}>
        {members.map((member) => (
          <Text
            key={member.memberId}
            testID={`room.member.${member.memberId}`}
            style={{
              color: member.kind === "ai" ? colors.brand : colors.ink2,
              fontFamily: member.kind === "ai" ? families.sansSemi : families.sans,
              fontSize: 14,
              marginRight: space.sm,
            }}
          >
            {member.name === "" ? t("room.defaultHostName") : member.name}
          </Text>
        ))}
      </View>
      {draft === null ? (
        <Pressable
          testID="room.name.chip"
          accessibilityRole="button"
          accessibilityLabel={t("room.youAre", { name: myName })}
          onPress={() => setDraft(me?.name ?? "")}
          style={{ alignSelf: "flex-start", paddingVertical: space.xxs }}
        >
          <Text style={{ color: colors.brand, fontFamily: families.sansMedium, fontSize: 12.5 }}>
            {t("room.youAre", { name: myName })}
          </Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: space.xxs }}>
          <TextInput
            testID="room.name.field"
            accessibilityLabel={t("room.nameAria")}
            autoFocus
            value={draft}
            placeholder={t("room.namePlaceholder")}
            placeholderTextColor={colors.ink3}
            onChangeText={setDraft}
            onSubmitEditing={save}
            returnKeyType="done"
            style={{
              flex: 1,
              color: colors.ink,
              fontFamily: families.sans,
              fontSize: 14,
              borderColor: colors.line2,
              borderWidth: 1,
              borderRadius: radius.field,
              paddingHorizontal: space.sm,
              paddingVertical: space.xxs,
            }}
          />
          <Pressable
            testID="room.name.save"
            accessibilityRole="button"
            accessibilityLabel={t("common.save")}
            onPress={save}
            style={({ pressed }) => ({
              marginLeft: space.xs,
              paddingVertical: space.xxs,
              paddingHorizontal: space.sm,
              borderRadius: radius.chip,
              backgroundColor: pressed ? colors.brandDeep : colors.brand,
            })}
          >
            <Text style={{ color: colors.onBrand, fontFamily: families.sansSemi, fontSize: 12.5 }}>
              {t("common.save")}
            </Text>
          </Pressable>
        </View>
      )}
      {refusal ? (
        <Text
          testID="room.name.error"
          style={{ color: colors.danger, fontFamily: families.sans, fontSize: 12.5 }}
        >
          {refusal}
        </Text>
      ) : null}
    </View>
  );
}
