import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Apple, ChevronRight, UserCircle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvalidEmailError, useAccount } from "../account/useAccount";
import {
  detectStoreSource,
  type StoreSource,
} from "../account/storeSource";
import { useLocale } from "../i18n";
import { Button, GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
  onOpenPro: () => void;
};

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._+\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? "";
    const b = parts[1]?.[0] ?? "";
    const pair = `${a}${b}`.toUpperCase();
    if (pair.length > 0) return pair;
  }
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase();
  if (cleaned.length === 1) return cleaned.toUpperCase();
  return email.slice(0, 1).toUpperCase();
}

/**
 * Account — full-screen overlay opened from the drawer.
 * Email sign-in is a local mock (AsyncStorage only). Hardware back owns itself.
 */
export function AccountScreen({ onBack, onOpenPro }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { email, isSignedIn, loading: accountLoading, signIn, signOut } = useAccount();

  const [storeSource, setStoreSource] = useState<StoreSource | null>(null);
  const [draft, setDraft] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    detectStoreSource()
      .then((source) => {
        if (mounted) setStoreSource(source);
      })
      .catch(() => {
        if (mounted) setStoreSource("none");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const loading = accountLoading || storeSource === null;

  const handleContinue = useCallback(async () => {
    setSocialNotice(null);
    setEmailError(null);
    setBusy(true);
    try {
      await signIn(draft);
      setDraft("");
    } catch (err) {
      if (err instanceof InvalidEmailError) {
        setEmailError(t("account.emailInvalid"));
      } else {
        setEmailError(t("account.saveFailed"));
      }
    } finally {
      setBusy(false);
    }
  }, [draft, signIn, t]);

  const handleSignOut = useCallback(async () => {
    setSignOutError(null);
    setBusy(true);
    try {
      await signOut();
    } catch {
      // Hook restores previous email on write failure; surface why the UI
      // snapped back so the failure is not silent.
      setSignOutError(t("account.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [signOut, t]);

  const handleSocialPress = useCallback(() => {
    setEmailError(null);
    setSocialNotice(t("account.socialUnavailable"));
  }, [t]);

  const hero = useMemo(() => {
    if (storeSource === "apple") {
      return {
        label: t("account.signInApple"),
        Icon: Apple,
      };
    }
    if (storeSource === "google") {
      return {
        label: t("account.signInGoogle"),
        Icon: UserCircle,
      };
    }
    return null;
  }, [storeSource, t]);

  const inputBorder = emailError ? colors.danger ?? colors.bad : colors.line;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.shell,
        zIndex: 50,
      }}
    >
      <Header
        title={t("account.title")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: insets.bottom,
          }}
          accessibilityRole="progressbar"
          accessibilityLabel={t("account.loading")}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.md,
          }}
        >
          {isSignedIn && email ? (
            <>
              <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={{ alignItems: "center", gap: spacing.sm }}>
                  <View
                    accessibilityRole="image"
                    accessibilityLabel={t("account.avatarA11y")}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      backgroundColor: colors.accentSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={[
                        typography.displayLg,
                        { color: colors.accent, fontFamily: fontFamilies.displayBold },
                      ]}
                    >
                      {initialsFromEmail(email)}
                    </Text>
                  </View>
                  <Text
                    style={[typography.bodyMd, { color: colors.ink }]}
                    selectable
                  >
                    {email}
                  </Text>
                </View>
              </GlassPanel2>

              <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
                <Text
                  style={[
                    typography.bodySm,
                    { color: colors.ink, fontFamily: fontFamilies.bodySemi },
                  ]}
                >
                  {t("account.planCurrent")}
                </Text>
                <Pressable
                  onPress={onOpenPro}
                  accessibilityRole="button"
                  accessibilityLabel={t("account.upgradeToPro")}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.accent,
                    backgroundColor: `${colors.accent}22`,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      { color: colors.accent, fontFamily: fontFamilies.bodySemi },
                    ]}
                  >
                    {t("account.upgradeToPro")}
                  </Text>
                  <ChevronRight size={18} color={colors.accent} />
                </Pressable>
              </GlassPanel2>

              <Pressable
                onPress={() => {
                  void handleSignOut();
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t("account.signOut")}
                style={({ pressed }) => ({
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: spacing.sm,
                  opacity: pressed || busy ? 0.7 : 1,
                })}
              >
                <Text style={[typography.bodySm, { color: colors.danger ?? colors.bad }]}>
                  {t("account.signOut")}
                </Text>
              </Pressable>
              {signOutError ? (
                <Text
                  style={[typography.bodyXs, { color: colors.danger ?? colors.bad }]}
                  accessibilityLiveRegion="polite"
                >
                  {signOutError}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {hero ? (
                <Pressable
                  onPress={handleSocialPress}
                  accessibilityRole="button"
                  accessibilityLabel={hero.label}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.sm,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: colors.accent,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <hero.Icon size={18} color={colors.primaryText} />
                  <Text
                    style={[
                      typography.bodyMd,
                      { color: colors.primaryText, fontFamily: fontFamilies.bodySemi },
                    ]}
                  >
                    {hero.label}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  <Pressable
                    disabled
                    accessibilityRole="button"
                    accessibilityState={{ disabled: true }}
                    accessibilityLabel={t("account.signInGoogle")}
                    style={{
                      minHeight: 48,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: spacing.sm,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.line,
                      backgroundColor: colors.panelBright,
                      opacity: 0.55,
                    }}
                  >
                    <UserCircle size={18} color={colors.muted} />
                    <Text style={[typography.bodyMd, { color: colors.muted }]}>
                      {t("account.signInGoogle")}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled
                    accessibilityRole="button"
                    accessibilityState={{ disabled: true }}
                    accessibilityLabel={t("account.signInApple")}
                    style={{
                      minHeight: 48,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: spacing.sm,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.line,
                      backgroundColor: colors.panelBright,
                      opacity: 0.55,
                    }}
                  >
                    <Apple size={18} color={colors.muted} />
                    <Text style={[typography.bodyMd, { color: colors.muted }]}>
                      {t("account.signInApple")}
                    </Text>
                  </Pressable>
                  <Text style={[typography.bodyXs, { color: colors.muted }]}>
                    {t("account.disabledProviders")}
                  </Text>
                </View>
              )}

              {socialNotice ? (
                <Text style={[typography.bodyXs, { color: colors.accent }]}>
                  {socialNotice}
                </Text>
              ) : null}

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
                <Text style={[typography.bodyXs, { color: colors.muted }]}>
                  {t("account.orContinueEmail")}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              </View>

              <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
                <TextInput
                  value={draft}
                  onChangeText={(value) => {
                    setDraft(value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder={t("account.emailPlaceholder")}
                  placeholderTextColor={colors.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  editable={!busy}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void handleContinue();
                  }}
                  accessibilityLabel={t("account.emailPlaceholder")}
                  style={{
                    minHeight: 44,
                    borderWidth: 1,
                    borderColor: inputBorder,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    color: colors.ink,
                    fontSize: (typography.bodyMd.fontSize as number) ?? 15,
                  }}
                />
                {emailError ? (
                  <Text
                    style={[typography.bodyXs, { color: colors.danger ?? colors.bad }]}
                    accessibilityLiveRegion="polite"
                  >
                    {emailError}
                  </Text>
                ) : null}
                <Button
                  label={t("common.continue")}
                  onPress={() => {
                    void handleContinue();
                  }}
                  disabled={busy || draft.trim().length === 0}
                  fullWidth
                  size="lg"
                />
              </GlassPanel2>

              <Text style={[typography.bodyXs, { color: colors.quiet ?? colors.muted }]}>
                {t("account.optionalHint")}
              </Text>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
