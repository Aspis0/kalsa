import { Apple, UserCircle } from "lucide-react-native";
import { Pressable, Text, TextInput, View } from "react-native";
import { type TranslateFn } from "../i18n";
import { radius, space, type, type DesignColors } from "../theme/design";
import { type StoreSource } from "../account/storeSource";

type Props = {
  colors: DesignColors;
  source: StoreSource;
  t: TranslateFn;
  draft: string;
  busy: boolean;
  error: string | null;
  socialNotice: string | null;
  inputBorder: string;
  onDraftChange: (value: string) => void;
  onContinue: () => void;
  onSocialPress: () => void;
};

const card = (colors: DesignColors) => ({
  backgroundColor: colors.surface,
  borderRadius: radius.card,
  padding: space.md,
  gap: space.sm,
});

export function AccountSignInPanel({
  colors,
  source,
  t,
  draft,
  busy,
  error,
  socialNotice,
  inputBorder,
  onDraftChange,
  onContinue,
  onSocialPress,
}: Props) {
  const hero = source === "apple" || source === "google";
  const HeroIcon = source === "apple" ? Apple : UserCircle;
  const providers = [
    { id: "google", Icon: UserCircle, label: t("account.signInGoogle") },
    { id: "apple", Icon: Apple, label: t("account.signInApple") },
  ] as const;

  return (
    <>
      {hero ? (
        <Pressable
          onPress={onSocialPress}
          accessibilityRole="button"
          accessibilityLabel={t(source === "apple" ? "account.signInApple" : "account.signInGoogle")}
          style={({ pressed }) => ({
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            borderRadius: radius.button,
            backgroundColor: pressed ? colors.tint : colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
          })}
        >
          <HeroIcon size={20} color={colors.accent} />
          <Text style={[type.bodyStrong, { color: colors.ink }]}>
            {t(source === "apple" ? "account.signInApple" : "account.signInGoogle")}
          </Text>
        </Pressable>
      ) : (
        <View style={{ gap: space.sm }}>
          {providers.map(({ id, Icon, label }) => (
            <Pressable
              key={id}
              disabled
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel={label}
              style={{
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                backgroundColor: colors.surface,
                borderColor: colors.line,
                borderWidth: 1,
                borderRadius: radius.button,
                opacity: 0.55,
              }}
            >
              <Icon size={20} color={colors.ink3} />
              <Text style={[type.bodyStrong, { color: colors.ink3 }]}>{label}</Text>
            </Pressable>
          ))}
          <Text style={[type.secondary, { color: colors.ink2 }]}>{t("account.disabledProviders")}</Text>
        </View>
      )}

      {socialNotice ? <Text style={[type.secondary, { color: colors.accent }]}>{socialNotice}</Text> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Text style={[type.secondary, { color: colors.ink3 }]}>{t("account.orContinueEmail")}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>

      <View style={card(colors)}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          placeholder={t("account.emailPlaceholder")}
          placeholderTextColor={colors.ink3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={onContinue}
          accessibilityLabel={t("account.emailPlaceholder")}
          style={{
            ...type.body,
            minHeight: 52,
            paddingHorizontal: space.md,
            borderRadius: radius.field,
            borderWidth: 1,
            borderColor: inputBorder,
            color: colors.ink,
          }}
        />
        {error ? (
          <Text style={[type.secondary, { color: colors.danger }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={onContinue}
          disabled={busy || draft.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel={t("common.continue")}
          accessibilityState={{ disabled: busy || draft.trim().length === 0 }}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.button,
            backgroundColor: busy || draft.trim().length === 0
              ? colors.tint
              : pressed ? colors.brandDeep : colors.brand,
          })}
        >
          <Text style={[type.bodyStrong, { color: busy || draft.trim().length === 0 ? colors.ink3 : colors.onBrand }]}>
            {t("common.continue")}
          </Text>
        </Pressable>
      </View>
      <Text style={[type.secondary, { color: colors.ink3 }]}>{t("account.optionalHint")}</Text>
    </>
  );
}
