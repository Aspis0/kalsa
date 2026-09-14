import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useLocale } from "../i18n";
import { testRemoteConnection } from "../engine/engineBackend";
import { REMOTE_MAC_MODEL_ID } from "../engine/remote/remoteMacModel";
import {
  DEFAULT_REMOTE_BRAIN_URL,
  DEFAULT_REMOTE_MAX_TOKENS,
  hydrateRemoteBrainSettings,
  isRemoteEngineBackend,
  setRemoteBrainUrl,
  setRemoteMaxTokens,
  setRemoteServerModelId,
} from "../engine/remote/remoteSettings";
import {
  getRemoteBrainToken,
  setRemoteBrainToken,
} from "../engine/remote/remoteSecret";
import { isHttpUrl, isNonLoopback } from "../engine/remote/remoteUrl";
import { GlassPanel2 } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  currentModelId: string;
  busy: boolean;
  onSelectModel: (modelId: string) => void;
};

export function RemoteBrainSettings({ currentModelId, busy, onSelectModel }: Props) {
  const { t } = useLocale();
  const { colors } = useLabTheme();
  const typography = useTypography();
  const [url, setUrl] = useState(DEFAULT_REMOTE_BRAIN_URL);
  const [serverModel, setServerModel] = useState("");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_REMOTE_MAX_TOKENS));
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(false);
  const active = currentModelId === REMOTE_MAC_MODEL_ID || isRemoteEngineBackend();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hydrated = await hydrateRemoteBrainSettings();
      let stored: string | null = null;
      try {
        stored = await getRemoteBrainToken();
      } catch {
        stored = null;
      }
      if (cancelled) return;
      setUrl(hydrated.url);
      setServerModel(hydrated.serverModelId);
      setMaxTokens(String(hydrated.maxTokens));
      setToken(stored ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistUrl = useCallback(async (next: string) => {
    setUrl(next);
    try {
      await setRemoteBrainUrl(next);
    } catch {
      setStatusOk(false);
      setStatus(t("settings.remoteBrainFail", { error: "invalid_url" }));
    }
  }, [t]);

  const persistToken = useCallback(async (next: string) => {
    setToken(next);
    await setRemoteBrainToken(next);
  }, []);

  const onTest = useCallback(async () => {
    setTesting(true);
    setStatus(null);
    try {
      await setRemoteBrainUrl(url);
      await setRemoteServerModelId(serverModel);
      await setRemoteMaxTokens(Number.parseInt(maxTokens, 10) || DEFAULT_REMOTE_MAX_TOKENS);
      await setRemoteBrainToken(token);
      const result = await testRemoteConnection();
      if (result.ok) {
        setStatusOk(true);
        setStatus(t("settings.remoteBrainOk", { model: result.modelId ?? "" }));
      } else {
        setStatusOk(false);
        setStatus(t("settings.remoteBrainFail", { error: result.error ?? "error" }));
      }
    } catch (err) {
      setStatusOk(false);
      setStatus(
        t("settings.remoteBrainFail", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setTesting(false);
    }
  }, [maxTokens, serverModel, t, token, url]);

  return (
    <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
        {t("settings.remoteBrain")}
      </Text>
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainHint")}
      </Text>

      <View
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
        <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
          {t("settings.remoteMac")}
        </Text>
        <Text style={[typography.bodyXs, { color: colors.muted }]}>
          {t("settings.remoteMacHint")}
        </Text>
        <Pressable
          onPress={() => onSelectModel(REMOTE_MAC_MODEL_ID)}
          disabled={busy || active}
          style={{
            alignSelf: "flex-start",
            marginTop: spacing.xs,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            backgroundColor: active ? `${colors.accent}22` : colors.accent,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Text style={[typography.bodyXs, { color: active ? colors.accent : colors.primaryText }]}>
            {active ? t("settings.modelActive") : t("settings.remoteSelect")}
          </Text>
        </Pressable>
      </View>

      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainUrl")}
      </Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        onEndEditing={() => void persistUrl(url)}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={DEFAULT_REMOTE_BRAIN_URL}
        placeholderTextColor={colors.muted}
        style={[
          typography.bodySm,
          {
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      />
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainModel")}
      </Text>
      <TextInput
        value={serverModel}
        onChangeText={setServerModel}
        onEndEditing={() => void setRemoteServerModelId(serverModel)}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t("settings.remoteBrainModelHint")}
        placeholderTextColor={colors.muted}
        style={[
          typography.bodySm,
          {
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      />
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainMaxTokens")}
      </Text>
      <TextInput
        value={maxTokens}
        onChangeText={setMaxTokens}
        onEndEditing={() =>
          void setRemoteMaxTokens(Number.parseInt(maxTokens, 10) || DEFAULT_REMOTE_MAX_TOKENS)
        }
        keyboardType="number-pad"
        style={[
          typography.bodySm,
          {
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      />
      {isHttpUrl(url) && isNonLoopback(url) ? (
        <Text style={[typography.bodyXs, { color: colors.bad ?? colors.muted }]}>
          {t("settings.remoteBrainHttpWarning")}
        </Text>
      ) : null}
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainToken")}
      </Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        onEndEditing={() => void persistToken(token)}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder={t("settings.remoteBrainTokenHint")}
        placeholderTextColor={colors.muted}
        style={[
          typography.bodySm,
          {
            color: colors.ink,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      />
      <Pressable
        onPress={() => void onTest()}
        disabled={testing}
        style={{
          alignSelf: "flex-start",
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.accent,
          opacity: testing ? 0.6 : 1,
        }}
      >
        {testing ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={[typography.bodyXs, { color: colors.accent }]}>
            {t("settings.remoteBrainTest")}
          </Text>
        )}
      </Pressable>
      {status ? (
        <Text
          style={[
            typography.bodyXs,
            { color: statusOk ? colors.accent : (colors.bad ?? colors.muted) },
          ]}
        >
          {status}
        </Text>
      ) : null}
      {active ? (
        <Text style={[typography.bodyXs, { color: colors.muted }]}>
          {t("settings.remoteGated")}
        </Text>
      ) : null}
    </GlassPanel2>
  );
}
