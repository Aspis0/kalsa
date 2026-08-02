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
import Constants from "expo-constants";
import { ChevronRight, CircleQuestionMark } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ModelPipelineState } from "../app/AppShell";
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
import {
  MODEL_REGISTRY,
  formatBytes,
  type ModelInfo,
} from "../engine/ModelRegistry";
import { GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

export type SettingsModelProps = {
  currentModelId: string;
  modelState: ModelPipelineState;
  /** 0–100 while downloading; null otherwise. */
  downloadPercent: number | null;
  modelError: string | null;
  /** True while an assistant stream is in flight — Select is disabled. */
  streaming: boolean;
  /** Presence map from a one-shot disk scan (keys appear after scan). */
  downloadedById: Record<string, boolean>;
  onSelectModel: (modelId: string) => void;
  onDownloadModel: (modelId: string) => void;
};

type Props = {
  onBack: () => void;
  /** Open Help overlay (AppShell sets activeOverlay to { kind: "help" }). */
  onOpenHelp: () => void;
  model: SettingsModelProps;
};

/** App version from Expo config; fallback keeps About usable in bare tests. */
const APP_VERSION = Constants.expoConfig?.version ?? "0.1.0";

const PROVIDER_LABEL_KEYS: Record<SearchProviderId, TranslationKey> = {
  "exa-mcp": "settings.providerExaMcp",
  exa: "settings.providerExa",
  brave: "settings.providerBrave",
  tavily: "settings.providerTavily",
};

function modelBundleSize(model: ModelInfo): number {
  return model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
}

/**
 * Settings — full-screen View overlay opened from the drawer.
 * Not a Modal: Android hardware back is handled here (dirty confirm for websearch).
 */
export function SettingsScreen({ onBack, onOpenHelp, model }: Props) {
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
  const modelBusy =
    model.modelState === "downloading" ||
    model.modelState === "loading" ||
    model.modelState === "checking" ||
    model.streaming;

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

  /**
   * Help leaves Settings (exclusive overlay). If websearch edits are dirty,
   * confirm discard first so the draft key is not silently lost on unmount.
   */
  const handleOpenHelp = useCallback(() => {
    if (busy) return;
    if (!dirty) {
      onOpenHelp();
      return;
    }
    Alert.alert(t("settings.unsavedTitle"), t("settings.unsavedBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.discard"),
        style: "destructive",
        onPress: onOpenHelp,
      },
    ]);
  }, [busy, dirty, onOpenHelp, t]);

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

  const activeStatusLabel = useMemo(() => {
    switch (model.modelState) {
      case "checking":
        return t("settings.modelChecking");
      case "missing":
        return t("settings.modelMissing");
      case "downloading":
        return t("settings.modelDownloading", {
          percent: model.downloadPercent ?? 0,
        });
      case "loading":
        return t("settings.modelLoading");
      case "ready":
        return t("settings.modelReady");
      case "error":
        return t("settings.modelError");
    }
  }, [model.downloadPercent, model.modelState, t]);

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
        {/* ── Language ─────────────────────────────────────────────────── */}
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

        {/* ── Web search ───────────────────────────────────────────────── */}
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

        {/* ── Models ───────────────────────────────────────────────────── */}
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.models")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.modelsHint")}
          </Text>

          <View style={{ gap: spacing.sm }}>
            {MODEL_REGISTRY.map((entry) => {
              const active = entry.id === model.currentModelId;
              const sizeLabel = formatBytes(modelBundleSize(entry));
              const downloaded = model.downloadedById[entry.id];
              return (
                <View
                  key={entry.id}
                  style={{
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.line,
                    backgroundColor: active ? `${colors.accent}14` : "transparent",
                    gap: spacing.xs,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing.sm,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          typography.bodySm,
                          {
                            color: colors.ink,
                            fontWeight: active ? "700" : "600",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {entry.name}
                      </Text>
                      <Text style={[typography.bodyXs, { color: colors.muted }]} numberOfLines={1}>
                        {entry.quant} · {sizeLabel}
                      </Text>
                      {typeof downloaded === "boolean" ? (
                        <Text
                          style={[
                            typography.bodyXs,
                            {
                              color: downloaded ? colors.good : colors.muted,
                              marginTop: 2,
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {downloaded
                            ? t("settings.modelDownloadedBadge")
                            : t("settings.modelNotDownloadedBadge")}
                        </Text>
                      ) : null}
                    </View>

                    {active ? (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 999,
                          backgroundColor: `${colors.accent}22`,
                        }}
                      >
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.accent, fontWeight: "700" },
                          ]}
                        >
                          {t("settings.modelActive")}
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => model.onSelectModel(entry.id)}
                        disabled={modelBusy}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: colors.line,
                          opacity: modelBusy ? 0.5 : 1,
                        }}
                      >
                        <Text
                          style={[
                            typography.bodyXs,
                            { color: colors.ink, fontWeight: "600" },
                          ]}
                        >
                          {t("settings.modelSelect")}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {active ? (
                    <View style={{ gap: spacing.xs }}>
                      <Text
                        style={[
                          typography.bodyXs,
                          {
                            color:
                              model.modelState === "error"
                                ? colors.bad
                                : model.modelState === "ready"
                                  ? colors.good
                                  : colors.muted,
                          },
                        ]}
                      >
                        {activeStatusLabel}
                      </Text>

                      {model.modelState === "downloading" && model.downloadPercent != null ? (
                        <View
                          style={{
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: colors.line,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height: 4,
                              width: `${model.downloadPercent}%`,
                              backgroundColor: colors.accent,
                            }}
                          />
                        </View>
                      ) : null}

                      {model.modelError ? (
                        <Text
                          style={[typography.bodyXs, { color: colors.bad }]}
                          numberOfLines={2}
                        >
                          {model.modelError}
                        </Text>
                      ) : null}

                      {model.modelState === "missing" || model.modelState === "error" ? (
                        <Pressable
                          onPress={() => model.onDownloadModel(entry.id)}
                          disabled={modelBusy}
                          style={{
                            marginTop: 2,
                            paddingVertical: spacing.sm,
                            borderRadius: radius.md,
                            backgroundColor: colors.accent,
                            alignItems: "center",
                            opacity: modelBusy ? 0.6 : 1,
                          }}
                        >
                          <Text
                            style={[
                              typography.bodySm,
                              { color: "#fff", fontWeight: "700" },
                            ]}
                          >
                            {t("settings.modelDownload")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </GlassPanel2>

        {/* ── Privacy ──────────────────────────────────────────────────── */}
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.privacy")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, lineHeight: 18 }]}>
            {t("settings.privacyBody")}
          </Text>
        </GlassPanel2>

        {/* ── Help (before About) ──────────────────────────────────────── */}
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Pressable
            onPress={handleOpenHelp}
            disabled={busy}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <CircleQuestionMark size={18} color={colors.accent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
                {t("settings.help")}
              </Text>
              <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                {t("settings.helpSubtitle")}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        </GlassPanel2>

        {/* ── About ────────────────────────────────────────────────────── */}
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.about")}
          </Text>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "700" }]}>
            {t("settings.aboutAppName")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("settings.aboutVersion", { version: APP_VERSION })}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, lineHeight: 18 }]}>
            {t("settings.aboutBody")}
          </Text>
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}
