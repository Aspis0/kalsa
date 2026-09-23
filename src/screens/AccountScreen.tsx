import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InvalidEmailError, useAccount } from "../account/useAccount";
import { detectStoreSource, type StoreSource } from "../account/storeSource";
import { useLocale } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { AccountSignInPanel } from "./AccountSignInPanel";

type Props = { onBack: () => void; onOpenPro: () => void };
type ThemeContext = { mode: ThemeMode };

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._+\-]+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.length > 1 ? cleaned.slice(0, 2).toUpperCase() : cleaned.toUpperCase() || email.slice(0, 1).toUpperCase();
}

/** Account overlay. Sign-in remains a local AsyncStorage-backed account action. */
export function AccountScreen({ onBack, onOpenPro }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { email, isSignedIn, loading: accountLoading, signIn, signOut } = useAccount();
  const [storeSource, setStoreSource] = useState<StoreSource | null>(null);
  const [draft, setDraft] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [socialNotice, setSocialNotice] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void detectStoreSource().then((source) => {
      if (mounted) setStoreSource(source);
    }).catch(() => {
      if (mounted) setStoreSource("none");
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const handleContinue = useCallback(async () => {
    setSocialNotice(null);
    setEmailError(null);
    setBusy(true);
    try {
      await signIn(draft);
      setDraft("");
    } catch (err) {
      setEmailError(err instanceof InvalidEmailError ? t("account.emailInvalid") : t("account.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [draft, signIn, t]);

  const handleSignOut = useCallback(async () => {
    setSignOutError(null);
    setBusy(true);
    try { await signOut(); } catch { setSignOutError(t("account.saveFailed")); } finally { setBusy(false); }
  }, [signOut, t]);

  const handleSocialPress = useCallback(() => {
    setEmailError(null);
    setSocialNotice(t("account.socialUnavailable"));
  }, [t]);

  const loading = accountLoading || storeSource === null;
  const cardStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
    ...e1,
  } as const;

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, backgroundColor: colors.page }}>
      <SettingsHeader title={t("account.title")} onBack={onBack} backLabel={t("common.back")} />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: insets.bottom }} accessibilityRole="progressbar" accessibilityLabel={t("account.loading")}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
          {isSignedIn && email ? (
            <>
              <View style={[cardStyle, { alignItems: "center", paddingVertical: space.xl }]}>
                <View accessibilityRole="image" accessibilityLabel={t("account.avatarA11y")} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: "center", justifyContent: "center" }}>
                  <Text style={[type.title, { color: colors.accent }]}>{initialsFromEmail(email)}</Text>
                </View>
                <Text selectable style={[type.bodyStrong, { color: colors.ink }]}>{email}</Text>
              </View>
              <View style={[cardStyle, { paddingVertical: 0, gap: 0 }]}>
                <Text style={[type.label, { color: colors.ink3, paddingTop: space.md }]}>{t("account.planCurrent").toLocaleUpperCase()}</Text>
                <Pressable onPress={onOpenPro} accessibilityRole="button" accessibilityLabel={t("account.upgradeToPro")} style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: pressed ? colors.tint : colors.surface })}>
                  <Text style={[type.bodyStrong, { color: colors.ink }]}>{t("account.upgradeToPro")}</Text>
                  <ChevronRight size={18} color={colors.ink3} strokeWidth={1.75} />
                </Pressable>
              </View>
              <Pressable onPress={() => void handleSignOut()} disabled={busy} accessibilityRole="button" accessibilityLabel={t("account.signOut")} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }}>
                <Text style={[type.body, { color: colors.danger }]}>{t("account.signOut")}</Text>
              </Pressable>
              {signOutError ? <Text style={[type.secondary, { color: colors.danger }]} accessibilityLiveRegion="polite">{signOutError}</Text> : null}
            </>
          ) : (
            <AccountSignInPanel
              colors={colors}
              source={storeSource ?? "none"}
              t={t}
              draft={draft}
              busy={busy}
              error={emailError}
              socialNotice={socialNotice}
              inputBorder={emailError ? colors.danger : colors.line}
              onDraftChange={(value) => { setDraft(value); if (emailError) setEmailError(null); }}
              onContinue={() => { void handleContinue(); }}
              onSocialPress={handleSocialPress}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}
