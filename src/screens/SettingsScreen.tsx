import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale, type Locale, type TranslationKey } from "../i18n";
import {
  getActiveProviderId,
  getSecret,
  PROVIDER_IDS,
  PROVIDERS,
  setActiveProviderId,
  setSecret,
  type SearchProviderId,
} from "../search";
import { GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
};

const PROVIDER_LABEL_KEYS: Record<SearchProviderId, TranslationKey> = {
  "exa-mcp": "settings.providerExaMcp",
  exa: "settings.providerExa",
  brave: "settings.providerBrave",
  tavily: "settings.providerTavily",
};

/**
 * Settings — full-screen View overlay opened from the drawer.
 * Not a Modal: Android hardware back is handled in AppShell.
 */
export function SettingsScreen({ onBack }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const { locale, setLocale, t } = useLocale();

  const languageOptions: Array<{ id: Locale; label: string }> = [
    { id: "en", label: t("settings.languageEn") },
    { id: "it", label: t("settings.languageIt") },
  ];

  const [providerId, setProviderId] = useState<SearchProviderId>("exa-mcp");
  const [apiKey, setApiKey] = useState("");
  /** Last successfully saved snapshot — used for dirty detection. */
  const [savedProviderId, setSavedProviderId] = useState<SearchProviderId>("exa-mcp");
  const [savedApiKey, setSavedApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  /** Generation counter: ignore out-of-order SecureStore reads after rapid provider switches. */
  const loadGen = useRef(0);
  /** Locale ref so load helpers always use the latest locale without re-running effects. */
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const meta = PROVIDERS[providerId];
  const needsKey = meta.needsKey;
  const busy = loading || saving;

  const dirty = useMemo(() => {
    if (providerId !== savedProviderId) return true;
    if (needsKey && apiKey !== savedApiKey) return true;
    return false;
  }, [apiKey, needsKey, providerId, savedApiKey, savedProviderId]);

  /** Load API key for a provider; does NOT re-run on locale change. */
  const loadKeyForProvider = useCallback(async (id: SearchProviderId) => {
    const gen = ++loadGen.current;
    setLoading(true);
    setStatus("idle");
    setStatusMessage("");
    try {
      if (PROVIDERS[id].needsKey) {
        const secret = await getSecret(id, localeRef.current);
        if (gen !== loadGen.current) return;
        setApiKey(secret ?? "");
      } else {
        if (gen !== loadGen.current) return;
        setApiKey("");
      }
    } catch (err) {
      if (gen !== loadGen.current) return;
      setStatus("error");
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  // Mount-only: resolve active provider + its key once.
  // Locale changes must NOT re-read SecureStore (would wipe an unsaved draft key).
  useEffect(() => {
    let mounted = true;
    const gen = ++loadGen.current;
    (async () => {
      setLoading(true);
      try {
        const active = await getActiveProviderId(localeRef.current);
        if (!mounted || gen !== loadGen.current) return;
        setProviderId(active);
        setSavedProviderId(active);
        if (PROVIDERS[active].needsKey) {
          const secret = await getSecret(active, localeRef.current);
          if (!mounted || gen !== loadGen.current) return;
          setApiKey(secret ?? "");
          setSavedApiKey(secret ?? "");
        } else {
          setApiKey("");
          setSavedApiKey("");
        }
      } catch (err) {
        if (!mounted || gen !== loadGen.current) return;
        setStatus("error");
        setStatusMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted && gen === loadGen.current) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectProvider = useCallback(
    async (id: SearchProviderId) => {
      if (id === providerId || busy) return;
      setShowKey(false);
      setProviderId(id);
      setStatus("idle");
      setStatusMessage("");
      // Load the stored key for the newly selected provider (draft for that provider).
      // Does not touch saved* until Save.
      await loadKeyForProvider(id);
    },
    [busy, loadKeyForProvider, providerId],
  );

  const handleSave = useCallback(async () => {
    if (busy) return;
    const targetId = providerId;
    const targetKey = apiKey;
    const targetNeedsKey = PROVIDERS[targetId].needsKey;

    setSaving(true);
    setStatus("idle");
    setStatusMessage("");
    try {
      // Key first for keyed providers: if setSecret fails, provider selection stays unchanged.
      if (targetNeedsKey) {
        await setSecret(targetId, targetKey, locale);
      }
      // Only update active provider after key success (and only if selection is still the same).
      if (providerId === targetId) {
        await setActiveProviderId(targetId);
      }
      setSavedProviderId(targetId);
      setSavedApiKey(targetNeedsKey ? targetKey : "");
      setStatus("saved");
      setStatusMessage(t("settings.saved"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus("error");
      setStatusMessage(t("settings.saveFailed", { message }));
    } finally {
      setSaving(false);
    }
  }, [apiKey, busy, locale, providerId, t]);

  const handleBack = useCallback(() => {
    if (busy) return;
    if (!dirty) {
      onBack();
      return;
    }
    Alert.alert(t("settings.unsavedTitle"), t("settings.unsavedBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.discard"),
        style: "destructive",
        onPress: onBack,
      },
    ]);
  }, [busy, dirty, onBack, t]);

  // Android hardware back: consume here so dirty confirmation is not skipped by AppShell.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const keyPlaceholder = useMemo(
    () => meta.keyPlaceholder ?? t("settings.apiKeyPlaceholder"),
    [meta.keyPlaceholder, t],
  );

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
      <Header title={t("settings.title")} onBack={handleBack} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.language")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.languageHint")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {languageOptions.map((option) => {
              const selected = locale === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (busy) return;
                    setLocale(option.id);
                  }}
                  disabled={busy}
                  style={{
                    flex: 1,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    alignItems: "center",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: selected ? colors.accent : colors.ink,
                        fontWeight: selected ? "700" : "500",
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassPanel2>

        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.webSearch")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.webSearchHint")}
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {t("settings.provider")}
              </Text>
              <View style={{ gap: spacing.xs }}>
                {PROVIDER_IDS.map((id) => {
                  const selected = providerId === id;
                  const labelKey = PROVIDER_LABEL_KEYS[id];
                  return (
                    <Pressable
                      key={id}
                      onPress={() => selectProvider(id)}
                      disabled={busy}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.line,
                        backgroundColor: selected ? `${colors.accent}22` : "transparent",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color: selected ? colors.accent : colors.ink,
                            fontWeight: selected ? "700" : "500",
                          },
                        ]}
                      >
                        {t(labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {needsKey ? (
                <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[typography.bodyXs, { color: colors.muted }]}>
                      {t("settings.apiKey")}
                    </Text>
                    <Pressable
                      onPress={() => setShowKey((v) => !v)}
                      hitSlop={8}
                      disabled={busy}
                    >
                      <Text style={[typography.bodyXs, { color: colors.accent, fontWeight: "600" }]}>
                        {showKey ? t("settings.hideKey") : t("settings.showKey")}
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={apiKey}
                    onChangeText={(text) => {
                      setApiKey(text);
                      setStatus("idle");
                    }}
                    editable={!busy}
                    placeholder={keyPlaceholder}
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="password"
                    importantForAutofill="no"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      color: colors.ink,
                      fontSize: 14,
                      opacity: busy ? 0.6 : 1,
                    }}
                  />
                  <Text style={[typography.bodyXs, { color: colors.muted }]}>
                    {t("settings.apiKeyHint")}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, marginTop: spacing.sm },
                  ]}
                >
                  {t("settings.keyNotNeeded")}
                </Text>
              )}

              {dirty ? (
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, marginTop: spacing.xs, fontStyle: "italic" },
                  ]}
                >
                  {t("settings.unsavedChanges")}
                </Text>
              ) : null}

              <Pressable
                onPress={handleSave}
                disabled={busy}
                style={{
                  marginTop: spacing.sm,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.accent,
                  alignItems: "center",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={[typography.bodySm, { color: "#fff", fontWeight: "700" }]}>
                  {saving ? t("settings.saving") : t("common.save")}
                </Text>
              </Pressable>

              {status !== "idle" && statusMessage ? (
                <Text
                  style={[
                    typography.bodyXs,
                    {
                      color: status === "error" ? "#c0392b" : colors.accent,
                      marginTop: spacing.xs,
                    },
                  ]}
                >
                  {statusMessage}
                </Text>
              ) : null}
            </>
          )}
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}
