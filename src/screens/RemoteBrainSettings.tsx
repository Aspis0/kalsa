import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useLocale } from "../i18n";
import { testRemoteConnection } from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import {
  DEFAULT_REMOTE_MAX_TOKENS,
  hydrateRemoteBrainSettings,
  isHydrationCurrent,
  isRemoteEngineBackend,
  setRemoteBrainUrl,
  setRemoteMaxTokens,
  setRemoteServerModelId,
} from "../engine/remote/remoteSettings";
import {
  getRemoteBrainToken,
  setRemoteBrainToken,
} from "../engine/remote/remoteSecret";
import {
  humanRemoteBrainError,
  isInternalErrorCode,
} from "../engine/remote/remoteBrainErrors";
import { LatestSave } from "../engine/remote/latestSave";
import {
  canCommitField,
  canCommitRemoteSettings,
  shouldHydrateField,
  type RemoteHydrationResult,
  type RemoteSettingsField,
} from "../engine/remote/remoteSettingsDraft";
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
  const [url, setUrl] = useState("");
  const [serverModel, setServerModel] = useState("");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_REMOTE_MAX_TOKENS));
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(false);
  const [hydratedReady, setHydratedReady] = useState(false);
  const dirtyRef = useRef<Set<RemoteSettingsField>>(new Set());
  /** What the fields hold right now: Test writes these, not its captured copy. */
  const draftRef = useRef({ url, serverModel, maxTokens, token });
  /** Per field: hydration produced the stored value (false = the read failed). */
  const hydratedRef = useRef<RemoteHydrationResult>({});
  const active = currentModelId === REMOTE_COMPUTER_MODEL_ID || isRemoteEngineBackend();
  const fieldsLocked = !hydratedReady;

  const markDirty = useCallback((field: RemoteSettingsField) => {
    dirtyRef.current.add(field);
  }, []);

  /** Storage is written only for values we read, or the user typed. */
  const canWrite = useCallback(
    (field: RemoteSettingsField) =>
      canCommitField({
        field,
        hydrated: hydratedRef.current,
        dirty: dirtyRef.current,
      }),
    [],
  );

  useEffect(() => {
    draftRef.current = { url, serverModel, maxTokens, token };
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hydrated = await hydrateRemoteBrainSettings();
        let stored: string | null = null;
        let tokenRead = false;
        try {
          stored = await getRemoteBrainToken();
          tokenRead = true;
        } catch {
          // Unreadable is NOT the same as absent: an empty commit would delete
          // a credential nobody managed to read.
          tokenRead = false;
        }
        // A snapshot a newer hydration replaced is obsolete: applying it would
        // show values that are no longer stored, and mark them as hydrated so a
        // commit could write them back.
        if (cancelled || !isHydrationCurrent(hydrated)) return;
        hydratedRef.current = {
          url: hydrated.hydrationOk,
          serverModel: hydrated.hydrationOk,
          maxTokens: hydrated.hydrationOk,
          token: tokenRead,
        };
        if (
          shouldHydrateField({
            cancelled,
            dirty: dirtyRef.current,
            field: "url",
          })
        ) {
          setUrl(hydrated.url);
        }
        if (
          shouldHydrateField({
            cancelled,
            dirty: dirtyRef.current,
            field: "serverModel",
          })
        ) {
          setServerModel(hydrated.serverModelId);
        }
        if (
          shouldHydrateField({
            cancelled,
            dirty: dirtyRef.current,
            field: "maxTokens",
          })
        ) {
          setMaxTokens(String(hydrated.maxTokens));
        }
        if (
          shouldHydrateField({
            cancelled,
            dirty: dirtyRef.current,
            field: "token",
          })
        ) {
          setToken(stored ?? "");
        }
      } finally {
        if (!cancelled) setHydratedReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** A write that throws (storage, keystore) must be seen, not swallowed. */
  const showWriteFailure = useCallback(
    (error: unknown) => {
      setStatusOk(false);
      const code = error instanceof Error ? error.message : "";
      setStatus(
        isInternalErrorCode(code)
          ? humanRemoteBrainError(code, t)
          : t("settings.remoteBrainSaveFailed"),
      );
    },
    [t],
  );

  /**
   * The token's writes are serialised (see LatestSave): a value typed while a
   * write is in flight must still end up stored, or the screen and the keystore
   * disagree with nothing to say so.
   */
  const tokenSaveRef = useRef<LatestSave<string> | null>(null);
  const showWriteFailureRef = useRef(showWriteFailure);
  showWriteFailureRef.current = showWriteFailure;
  if (!tokenSaveRef.current) {
    tokenSaveRef.current = new LatestSave(
      (value) => setRemoteBrainToken(value),
      () => draftRef.current.token,
      (error) => showWriteFailureRef.current(error),
    );
  }
  const tokenSave = tokenSaveRef.current;

  const persistUrl = useCallback(async (next: string) => {
    if (!canCommitRemoteSettings(hydratedReady) || !canWrite("url")) return;
    setUrl(next);
    try {
      await setRemoteBrainUrl(next);
    } catch (err) {
      showWriteFailure(err);
    }
  }, [canWrite, hydratedReady, showWriteFailure]);

  const persistServerModel = useCallback(async (next: string) => {
    if (!canCommitRemoteSettings(hydratedReady) || !canWrite("serverModel")) {
      return;
    }
    setServerModel(next);
    try {
      await setRemoteServerModelId(next);
    } catch (err) {
      showWriteFailure(err);
    }
  }, [canWrite, hydratedReady, showWriteFailure]);

  const persistMaxTokens = useCallback(async (next: string) => {
    if (!canCommitRemoteSettings(hydratedReady) || !canWrite("maxTokens")) return;
    try {
      await setRemoteMaxTokens(
        Number.parseInt(next, 10) || DEFAULT_REMOTE_MAX_TOKENS,
      );
    } catch (err) {
      showWriteFailure(err);
    }
  }, [canWrite, hydratedReady, showWriteFailure]);

  const persistToken = useCallback(async (next: string) => {
    if (!canCommitRemoteSettings(hydratedReady) || !canWrite("token")) return;
    // The draft carries the new value before the save reads it, and the writer
    // makes sure a token typed while this write is in flight still lands.
    draftRef.current = { ...draftRef.current, token: next };
    setToken(next);
    tokenSave.markEdited();
    await tokenSave.save();
  }, [canWrite, hydratedReady, tokenSave]);

  const onTest = useCallback(async () => {
    if (!canCommitRemoteSettings(hydratedReady)) return;
    setTesting(true);
    setStatus(null);
    try {
      // Credential first, cheapest field last: a partial failure must never
      // lose the token. Each field is read when it is written, so text typed
      // while the earlier writes are in flight still wins.
      if (canWrite("token")) await tokenSave.save();
      if (canWrite("url")) await setRemoteBrainUrl(draftRef.current.url);
      if (canWrite("serverModel")) {
        await setRemoteServerModelId(draftRef.current.serverModel);
      }
      if (canWrite("maxTokens")) {
        await setRemoteMaxTokens(
          Number.parseInt(draftRef.current.maxTokens, 10) ||
            DEFAULT_REMOTE_MAX_TOKENS,
        );
      }
      const result = await testRemoteConnection();
      if (result.ok) {
        setStatusOk(true);
        setStatus(t("settings.remoteBrainOk", { model: result.modelId ?? "" }));
      } else {
        setStatusOk(false);
        setStatus(humanRemoteBrainError(result.error, t));
      }
    } catch (err) {
      // A write threw: the remaining fields were not saved and the probe did
      // not run, so say that instead of reporting a connection result.
      showWriteFailure(err);
    } finally {
      setTesting(false);
    }
  }, [canWrite, hydratedReady, showWriteFailure, t, tokenSave]);

  return (
    <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
        {t("settings.remoteBrain")}
      </Text>
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("settings.remoteBrainHint")}
      </Text>
      <Text
        style={[typography.bodyXs, { color: colors.muted }]}
        testID="remote-brain-disclosure"
      >
        {t("settings.remoteBrainDisclosure")}
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
          {t("settings.remoteComputer")}
        </Text>
        <Text style={[typography.bodyXs, { color: colors.muted }]}>
          {t("settings.remoteComputerHint")}
        </Text>
        <Pressable
          onPress={() => {
            void (async () => {
              if (!hydratedReady) return;
              // Validate before touching storage: an empty field must not be
              // written (and then reported as an error) first.
              if (!url.trim()) {
                setStatusOk(false);
                setStatus(t("settings.remoteBrainUrlMissing"));
                return;
              }
              try {
                await setRemoteBrainUrl(url);
              } catch (err) {
                showWriteFailure(err);
                return;
              }
              onSelectModel(REMOTE_COMPUTER_MODEL_ID);
            })();
          }}
          disabled={busy || active || !hydratedReady}
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
        onChangeText={(next) => {
          markDirty("url");
          setUrl(next);
        }}
        onEndEditing={() => void persistUrl(url)}
        editable={!fieldsLocked}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={t("settings.remoteBrainUrlHint")}
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
        onChangeText={(next) => {
          markDirty("serverModel");
          setServerModel(next);
        }}
        onEndEditing={() => void persistServerModel(serverModel)}
        editable={!fieldsLocked}
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
        onChangeText={(next) => {
          markDirty("maxTokens");
          setMaxTokens(next);
        }}
        onEndEditing={() => void persistMaxTokens(maxTokens)}
        editable={!fieldsLocked}
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
        onChangeText={(next) => {
          markDirty("token");
          tokenSave.markEdited();
          setToken(next);
        }}
        onEndEditing={() => void persistToken(token)}
        editable={!fieldsLocked}
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
        disabled={testing || fieldsLocked}
        style={{
          alignSelf: "flex-start",
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.accent,
          opacity: testing || fieldsLocked ? 0.6 : 1,
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
