import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX, Globe as LucideGlobe, Settings as LucideSettings } from "lucide-react-native";

import { AiChatPage, type ChatCta, type LocalAttachment } from "../screens/AiChatPage";
import { HelpScreen } from "../screens/HelpScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { AskAssistantMiniappRenderer } from "../ui/AskAssistantMiniappRenderer";
import { Drawer, PainterlyBg, type DrawerItem } from "../theme/components";
import { spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import { handleAskAssistantMiniappAction } from "./miniappActions";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { MODEL_REGISTRY, getDefaultModel, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { downloadModelBundle, friendlyNetworkError, isModelBundleDownloaded, modelLocalPath } from "../engine/ModelDownloader";
import { disposeEngine, getActiveModelId, initEngine, isEngineReady, streamAssistantTurn, type EngineMessage, type EngineTurnOptions } from "../engine/LlamaService";
import { WEB_SEARCH_TOOL, makeWebSearchExecutor, mapSearchSourcesToChat } from "../agent/webSearchTool";
import { useLocale } from "../i18n";

/** Shared model pipeline states (download / load / ready) — used by Settings. */
export type ModelPipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

type ModelState = ModelPipelineState;

/** Exclusive full-screen overlays (drawer stays separate — transient chrome). */
type ActiveOverlay =
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "miniapp"; miniapp: AskAssistantMiniapp }
  | null;

const MODEL_STORAGE_KEY = "kalsa.model.id";

/**
 * AppShell — la schermata unica di AI Chat (Fase 1).
 *
 * Refactor del monolite originale (App.tsx, 3655 righe): qui restano solo
 * chat + barra modello + Ask AI + viewer miniapp. L'engine locale gira su
 * llama.rn; la barra modello gestisce download/switch dei GGUF.
 */
export function AppShell() {
  const { colors, styles } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Websearch (Fase 2): SEMPRE ATTIVO — è il modello a decidere se usarlo
  // (info attuali, notizie, o richiesta esplicita). Le query partono solo
  // quando il tool viene chiamato (privacy by design).
  const agentOptions = useMemo<EngineTurnOptions>(
    () => ({
      tools: [WEB_SEARCH_TOOL],
      executeTool: makeWebSearchExecutor(locale),
    }),
    [locale],
  );

  // ── Drawer + exclusive overlay (settings | miniapp | null) ────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const edgeSwipe = Gesture.Pan()
    .activeOffsetX(24)
    .failOffsetY([-15, 15]) // scroll verticale NON deve aprire il drawer
    .hitSlop({ left: 0, width: 48 }) // solo dal bordo sinistro: niente conflitti con sources/scroll
    .runOnJS(true)
    .onStart(() => setDrawerOpen(true));
  const drawerItems: DrawerItem[] = useMemo(
    () => [
      {
        id: "settings",
        label: t("common.settings"),
        Icon: LucideSettings,
        onPress: () => {
          Keyboard.dismiss();
          setDrawerOpen(false);
          // Opening settings replaces any open miniapp (exclusive overlay).
          setActiveOverlay({ kind: "settings" });
        },
      },
    ],
    [t],
  );

  // Android hardware back while Settings/Help is open: each screen owns its
  // BackHandler (Settings: dirty-confirm; Help: return to Settings). AppShell
  // must NOT register a competing handler that would bypass those paths.

  // ── Notifiche locali (download) ──────────────────────────────────────────
  const notifyDownload = useCallback(async (title: string, body: string) => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        const requested = await Notifications.requestPermissionsAsync();
        if (!requested.granted) return;
      }
      // Android 8+: le notifiche devono appartenere a un channel. Il canale
      // "default" è quello usato dalle notifiche immediate (trigger null).
      await Notifications.setNotificationChannelAsync("default", {
        name: t("notify.channelName"),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        // channelId va nel trigger (non in content): trigger null usa il canale fallback Android.
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: "default",
        },
      });
    } catch (error) {
      // notifiche non disponibili: non bloccante, ma non silenzioso in debug
      console.warn("[notifyDownload]", error);
    }
  }, [t]);

  // ── Stato modello ────────────────────────────────────────────────────────
  const [modelIndex, setModelIndex] = useState(() =>
    Math.max(0, MODEL_REGISTRY.findIndex((m) => m.id === getDefaultModel().id)),
  );
  const [modelState, setModelState] = useState<ModelState>("checking");
  const [download, setDownload] = useState<{ bytesReceived: number; bytesTotal: number; progress: number } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const currentModel = MODEL_REGISTRY[modelIndex];
  // Ref speculare per il race tra check iniziale e load della preferenza.
  const modelIndexRef = useRef(modelIndex);
  modelIndexRef.current = modelIndex;

  // Riconoscimento modello all'avvio: ripristina l'ultimo modello usato
  // (come la selezione persistita), NON sempre il default.
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(MODEL_STORAGE_KEY)
      .then((saved) => {
        if (!mounted || !saved) return;
        const savedIndex = MODEL_REGISTRY.findIndex((model) => model.id === saved);
        if (savedIndex >= 0) setModelIndex(savedIndex);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  // Guard sincrone per download/switch/stream (non soggette al batching di React).
  const downloadInFlight = useRef(false);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const engineGenerationRef = useRef(0);
  const streamInFlightRef = useRef(false);
  const modelSwitchInFlightRef = useRef(false);
  /** UI mirror of streamInFlightRef — disables model Select in Settings. */
  const [streaming, setStreaming] = useState(false);
  /** Per-model download presence for Settings badges (scanned when Settings opens). */
  const [downloadedById, setDownloadedById] = useState<Record<string, boolean>>({});

  const showNotice = useCallback((value: string) => {
    setNotice(value);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      engineGenerationRef.current += 1; // invalida ogni async in corso
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      void disposeEngine();
    };
  }, []);

  // Controllo iniziale: il modello corrente è già scaricato?
  useEffect(() => {
    let mounted = true;
    const checkedIndex = modelIndexRef.current;
    void (async () => {
      try {
        const ok = await isModelBundleDownloaded(MODEL_REGISTRY[checkedIndex]);
        // Il modello selezionato potrebbe essere cambiato nel frattempo (load preferenza).
        if (mounted && modelIndexRef.current === checkedIndex) {
          setModelState(ok ? "ready" : "missing");
        }
      } catch {
        if (mounted && modelIndexRef.current === checkedIndex) setModelState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIndex]);

  const ensureEngineForModel = useCallback(async (model: ModelInfo): Promise<boolean> => {
    // Capture generation + expected model BEFORE any await (race with selectModel).
    const generation = engineGenerationRef.current;
    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    if (isEngineReady() && getActiveModelId() === model.id) return true;
    if (!(await isModelBundleDownloaded(model))) return false;
    if (!stillCurrent()) return false;

    setModelState("loading");
    try {
      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      await initEngine(modelLocalPath(model, model.file), model.id, {
        mmprojPath,
        nCtx: model.engineCtx,
        cacheTypeK: model.kvCache.k,
        cacheTypeV: model.kvCache.v,
        kvUnified: model.kvUnified,
        mtpNMax: model.mtp?.nMax,
        locale,
      });
      if (!stillCurrent()) return false;
      setModelState("ready");
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      setModelState("error");
      setModelError(friendlyNetworkError(error, locale, "engine").message);
      return false;
    }
  }, [locale]);

  const selectModel = useCallback(
    (nextIndex: number) => {
      if (
        downloadInFlight.current ||
        modelSwitchInFlightRef.current ||
        modelState === "downloading" ||
        modelState === "loading"
      ) {
        return;
      }
      if (nextIndex < 0 || nextIndex >= MODEL_REGISTRY.length) return;
      if (nextIndex === modelIndex) return;

      // Sync transition: bump generation + show checking before dispose awaits.
      modelSwitchInFlightRef.current = true;
      engineGenerationRef.current += 1;
      modelIndexRef.current = nextIndex; // keep stillCurrent() correct before re-render
      setModelIndex(nextIndex);
      setModelState("checking");
      setModelError(null);
      // Persisti la selezione: riconoscimento al riavvio (come Atomic Chat).
      AsyncStorage.setItem(MODEL_STORAGE_KEY, MODEL_REGISTRY[nextIndex].id).catch(() => undefined);

      void disposeEngine()
        .catch(() => undefined)
        .finally(() => {
          modelSwitchInFlightRef.current = false;
        });
    },
    [modelIndex, modelState],
  );

  /** Settings: select by model id (same storage key + engine dispose path). */
  const selectModelById = useCallback(
    (modelId: string) => {
      const nextIndex = MODEL_REGISTRY.findIndex((m) => m.id === modelId);
      if (nextIndex < 0) return;
      if (streamInFlightRef.current) {
        Alert.alert(
          t("settings.switchWhileStreamingTitle"),
          t("settings.switchWhileStreamingBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("common.continue"),
              style: "destructive",
              onPress: () => selectModel(nextIndex),
            },
          ],
        );
        return;
      }
      selectModel(nextIndex);
    },
    [selectModel, t],
  );

  const startDownload = useCallback(async (modelId: string) => {
    if (downloadInFlight.current || modelState === "downloading") return;
    const model = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!model) return;

    downloadInFlight.current = true;
    // Capture generation at start; also re-check selected model after awaits.
    const generation = engineGenerationRef.current;
    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setModelState("downloading");
    setModelError(null);
    const bundleTotal = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
    setDownload({ bytesReceived: 0, bytesTotal: bundleTotal, progress: 0 });
    try {
      const outcome = await downloadModelBundle(model, {
        onBundleProgress: (progress) => {
          if (!stillCurrent()) return;
          setDownload({
            bytesReceived: Math.round(progress.overall * bundleTotal),
            bytesTotal: bundleTotal,
            progress: progress.overall,
          });
        },
        signal: controller.signal,
        locale,
      });
      if (!stillCurrent()) return;
      if (outcome.model.status === "aborted" || outcome.mmproj?.status === "aborted") {
        setModelState("missing");
        return;
      }
      if (!(await isModelBundleDownloaded(model))) {
        if (!stillCurrent()) return;
        setModelState("error");
        setModelError(t("download.incomplete"));
        return;
      }
      if (!stillCurrent()) return;
      setModelState("loading");
      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      await initEngine(outcome.model.uri, model.id, {
        mmprojPath,
        nCtx: model.engineCtx,
        cacheTypeK: model.kvCache.k,
        cacheTypeV: model.kvCache.v,
        kvUnified: model.kvUnified,
        mtpNMax: model.mtp?.nMax,
        locale,
      });
      if (!stillCurrent()) return;
      setModelState("ready");
      setDownloadedById((prev) => ({ ...prev, [model.id]: true }));
      showNotice(t("download.readyNotice", { name: model.name }));
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyReady", { name: model.name }),
      );
    } catch (error) {
      if (!stillCurrent()) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
      const friendly = friendlyNetworkError(error, locale, "download").message;
      setModelError(friendly);
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyFailed", { error: friendly }),
      );
    } finally {
      downloadInFlight.current = false;
      downloadAbortRef.current = null;
    }
  }, [locale, modelState, notifyDownload, showNotice, t]);

  // Conferma esplicita prima del download (mai automatico) — always bound to modelId.
  const confirmDownload = useCallback(
    (modelId: string) => {
      const model = MODEL_REGISTRY.find((m) => m.id === modelId);
      if (!model) return;
      const total = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
      Alert.alert(
        t("download.title"),
        t("download.confirmBody", { name: model.name, size: formatBytes(total) }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.download"), onPress: () => void startDownload(modelId) },
        ],
      );
    },
    [startDownload, t],
  );

  // When Settings opens, scan which models are fully on disk (once per open + after state changes).
  useEffect(() => {
    if (activeOverlay?.kind !== "settings") return;
    let mounted = true;
    void (async () => {
      const entries = await Promise.all(
        MODEL_REGISTRY.map(async (m) => {
          try {
            const ok = await isModelBundleDownloaded(m);
            return [m.id, ok] as const;
          } catch {
            return [m.id, false] as const;
          }
        }),
      );
      if (!mounted) return;
      const map: Record<string, boolean> = {};
      for (const [id, ok] of entries) map[id] = ok;
      setDownloadedById(map);
    })();
    return () => {
      mounted = false;
    };
  }, [activeOverlay?.kind, modelState]);

  // ── Chat wiring ──────────────────────────────────────────────────────────
  const handleMiniappAction = useCallback(
    (action: Record<string, unknown>, miniapp: AskAssistantMiniapp) => {
      void handleAskAssistantMiniappAction(action, miniapp, {
        setAskAssistantDraft: () => undefined,
        setFeedback: showNotice,
        setMobileError: (value) => showNotice(`⚠️ ${value}`),
        locale,
      });
    },
    [locale, showNotice],
  );

  const handleSendStream = useCallback(
    (text: string, callbacks: any, signal: AbortSignal, attachments?: LocalAttachment[], history?: unknown[]) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          streamInFlightRef.current = false;
          setStreaming(false);
          resolve();
        };
        const fail = (message: string) => {
          callbacks.onDelta?.(`⚠️ ${message}`, `⚠️ ${message}`);
          finish();
        };

        streamInFlightRef.current = true;
        setStreaming(true);

        void (async () => {
          try {
            if (!(await ensureEngineForModel(currentModel))) {
              fail(t("chat.modelNotDownloaded", { name: currentModel.name }));
              return;
            }
            // Memoria conversazionale: ultimi N messaggi (validati e limitati).
            // Con immagini il budget di contesto si riduce: 8 messaggi × 2000 char.
            const hasImages = Boolean(attachments?.length);
            const maxHistory = hasImages ? 8 : 20;
            const maxChars = hasImages ? 2000 : 4000;
            const engineMessages: EngineMessage[] = (history ?? [])
              .filter(
                (m) =>
                  m &&
                  typeof m === "object" &&
                  typeof (m as { text?: unknown }).text === "string" &&
                  ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant"),
              )
              .slice(-maxHistory)
              .map((m) => ({
                role: (m as { role: string }).role as "user" | "assistant",
                content: ((m as { text: string }).text as string).slice(0, maxChars),
              }));

            // Immagini da allegare all'ultimo messaggio user (cap 5):
            // immagini dirette + pagine PDF renderizzate.
            const images: string[] = [];
            for (const attachment of attachments ?? []) {
              if (images.length >= 5) break;
              if (attachment.kind === "image" && attachment.uri) {
                images.push(attachment.uri);
              } else if (attachment.kind === "pdf" && attachment.pages?.length) {
                for (const page of attachment.pages) {
                  if (images.length >= 5) break;
                  images.push(page);
                }
              }
            }
            const userMessage: EngineMessage = { role: "user", content: text };
            if (images.length) userMessage.images = images;
            engineMessages.push(userMessage);

            await streamAssistantTurn(
              engineMessages,
              {
                onDelta: callbacks.onDelta,
                onStatus: (status) => callbacks.onStatus?.(status),
                onSources: (sources) =>
                  callbacks.onSources?.(mapSearchSourcesToChat(sources as any, locale)),
                onMiniapp: (miniapp) => callbacks.onMiniapp?.(miniapp),
                onTool: (tool) => callbacks.onActions?.({ kind: "tool", tool }),
                onDone: () => finish(),
                onError: (error) => {
                  callbacks.onDelta?.(`⚠️ ${error.message}`, `⚠️ ${error.message}`);
                  finish();
                },
              },
              signal,
              { ...agentOptions, locale },
            );
            // Safety: if the stream returns without onDone/onError (e.g. abort path).
            finish();
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
          }
        })();
      }),
    [agentOptions, currentModel, ensureEngineForModel, locale, t],
  );

  // ── Render barra modello ─────────────────────────────────────────────────
  const progressPercent = download ? Math.round(download.progress * 100) : 0;

  const modelBarStatus = (() => {
    const engineLoaded = isEngineReady() && getActiveModelId() === currentModel.id;
    switch (modelState) {
      case "checking":
        return { label: t("download.checking"), color: colors.muted };
      case "missing":
        return {
          label: t("download.missing", {
            size: formatBytes(currentModel.sizeBytes + (currentModel.mmproj?.sizeBytes ?? 0)),
          }),
          color: colors.accent,
        };
      case "downloading":
        return {
          label: t("download.downloading", { percent: progressPercent }),
          color: colors.accent,
        };
      case "loading":
        return { label: t("download.loading"), color: colors.muted };
      case "error":
        return { label: t("download.failedRetry"), color: colors.bad };
      case "ready":
        return {
          label: engineLoaded ? t("download.readyLocal") : t("download.downloaded"),
          color: engineLoaded ? colors.good : colors.muted,
        };
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.shell }}>
      <PainterlyBg />
      <GestureDetector gesture={edgeSwipe}>
      <View style={{ flex: 1 }}>
      {/* AiChatPage gestisce già le proprie safe-area (nav top + composer bottom). */}
      <SafeAreaView style={{ flex: 1 }} edges={[]}>
        {/* Header compatto: titolo + modello/stato in una riga */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + 4,
            paddingBottom: 2,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                typography.bodyMd,
                { color: colors.ink, fontWeight: "700", letterSpacing: 0.2, lineHeight: 20 },
              ]}
              numberOfLines={1}
            >
              Kalsa
            </Text>
            {/* Indicatore modello (selezione in Settings). Tap = download se manca/errore. */}
            <Pressable
              onPress={() => {
                if (modelState === "missing" || modelState === "error") confirmDownload(currentModel.id);
              }}
              disabled={modelState !== "missing" && modelState !== "error"}
              hitSlop={6}
            >
              <Text style={[typography.bodyXs, { color: modelBarStatus.color, lineHeight: 15 }]} numberOfLines={1}>
                {currentModel.name} · {currentModel.quant} · {modelBarStatus.label}
              </Text>
            </Pressable>
          </View>

          {/* Badge statico: la web search è sempre disponibile */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: `${colors.accent}22`,
              borderWidth: 1,
              borderColor: `${colors.accent}55`,
            }}
          >
            <LucideGlobe size={11} color={colors.accent} />
            <Text style={[typography.monoXs, { color: colors.accent, fontWeight: "700" }]}>
              {t("common.web")}
            </Text>
          </View>
        </View>

        {/* Progress bar sottile, solo durante il download */}
        {modelState === "downloading" ? (
          <View
            style={{
              marginHorizontal: spacing.lg,
              marginBottom: spacing.xs,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line,
              overflow: "hidden",
            }}
          >
            <View style={{ height: 4, width: `${progressPercent}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}

        {modelError ? (
          <Text
            style={[
              typography.bodyXs,
              { color: colors.bad, marginHorizontal: spacing.lg, marginBottom: spacing.xs },
            ]}
            numberOfLines={1}
          >
            {modelError}
          </Text>
        ) : null}

        <View style={{ flex: 1 }}>
          <AiChatPage
            userName={null}
            selectedRun={null}
            prefillText={null}
            onSendStream={handleSendStream}
            onOpenMiniapp={(miniapp) => {
              // Policy: ignore miniapp open while Settings/Help is active
              // (exclusive overlay; stays until user closes it).
              setActiveOverlay((prev) =>
                prev?.kind === "settings" || prev?.kind === "help"
                  ? prev
                  : { kind: "miniapp", miniapp: miniapp as AskAssistantMiniapp },
              );
            }}
            onCtaPress={(_cta: ChatCta) => undefined}
            onMenuPress={() => setDrawerOpen(true)}
          />
        </View>

        {notice ? (
          <View
            style={{
              position: "absolute",
              left: spacing.lg,
              right: spacing.lg,
              bottom: 96,
              backgroundColor: colors.panelSolid,
              borderRadius: 12,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text style={[typography.bodyXs, { color: colors.ink }]}>{notice}</Text>
          </View>
        ) : null}
      </SafeAreaView>
      </View>
      </GestureDetector>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        brand="Kalsa"
        subtitle={t("drawer.subtitle")}
        items={drawerItems}
      />

      {activeOverlay?.kind === "settings" ? (
        <SettingsScreen
          onBack={() => setActiveOverlay(null)}
          onOpenHelp={() => setActiveOverlay({ kind: "help" })}
          model={{
            currentModelId: currentModel.id,
            modelState,
            downloadPercent: modelState === "downloading" ? progressPercent : null,
            modelError,
            streaming,
            downloadedById,
            onSelectModel: selectModelById,
            onDownloadModel: confirmDownload,
          }}
        />
      ) : null}

      {activeOverlay?.kind === "help" ? (
        <HelpScreen
          // Back from Help returns to Settings (Help is opened from Settings).
          onBack={() => setActiveOverlay({ kind: "settings" })}
        />
      ) : null}

      {activeOverlay?.kind === "miniapp" ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setActiveOverlay(null)}
          statusBarTranslucent
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.shell }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <Text
                style={{ flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink }}
                numberOfLines={1}
              >
                {activeOverlay.miniapp.title}
              </Text>
              <Pressable onPress={() => setActiveOverlay(null)} hitSlop={8}>
                <LucideX size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <AskAssistantMiniappRenderer
                colors={colors}
                miniapp={activeOverlay.miniapp}
                onAction={(action, miniapp) =>
                  handleMiniappAction(action as Record<string, unknown>, miniapp as AskAssistantMiniapp)
                }
                styles={styles}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}
