import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useLocale } from "../i18n";
import { parsePairingInvite } from "../pairing/pairingInvite";
import type { PairingSquare } from "../pairing/pairingTransport";

type Props = {
  disabled: boolean;
  onInvite: (square: PairingSquare) => void;
};

export function PairingInvitePaste({ disabled, onInvite }: Props) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    const result = parsePairingInvite(value);
    if (!result.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setValue("");
    onInvite(result.square);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: "600" }}>{t("pairing.pasteInvite")}</Text>
      <TextInput
        testID="pairing.invite.input"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setInvalid(false);
        }}
        placeholder={t("pairing.pasteInviteHint")}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        editable={!disabled}
        maxLength={16_384}
        style={{ minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 10 }}
      />
      {invalid ? <Text testID="pairing.invite.invalid">{t("pairing.inviteInvalid")}</Text> : null}
      <Pressable
        testID="pairing.invite.submit"
        accessibilityRole="button"
        accessibilityLabel={t("pairing.pasteInvite")}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={submit}
      >
        <Text>{t("pairing.pasteInvite")}</Text>
      </Pressable>
    </View>
  );
}
