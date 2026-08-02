import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX, Globe as LucideGlobe } from "lucide-react-native";

import { AiChatPage, type ChatCta, type LocalAttachment } from "../screens/AiChatPage";
import { AskAssistantMiniappRenderer } from "../ui/AskAssistantMiniappRenderer";
import { PainterlyBg } from "../theme/components";
import { spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import { handleAskAssistantMiniappAction } from "./miniappActions";
import { Drawer, type DrawerItem } from "../theme/components";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { MODEL_REGISTRY, getDefaultModel, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { downloadModelBundle, isModelBundleDownloaded, modelLocalPath } from "../engine/ModelDownloader";
import { disposeEngine, getActiveModelId, initEngine, isEngineReady, streamAssistantTurn, type EngineMessage, type EngineTurnOptions } from "../engine/LlamaService";
import { WEB_SEARCH_TOOL, makeWebSearchExecutor, mapExaSourcesToChat } from "../agent/webSearchTool";

type ModelState = "checking" | "missing" | "downloading" | "loading" | "ready" | "error";

const MODEL_STORAGE_KEY = "ai-chat.model.id";

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
  const [activeMiniapp, setActiveMiniapp] = useState<AskAssistantMiniapp | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Websearch (Fase 2): SEMPRE ATTIVO — è il modello a decidere se usarlo
  // (info attuali, notizie, o richiesta esplicita). Le query partono solo
  // quando il tool viene chiamato (privacy by design).
  const agentOptions = useMemo<EngineTurnOptions>(
    () => ({ tools: [WEB_SEARCH_TOOL], executeTool: makeWebSearchExecutor() }),
    [],
  );

  // ── Drawer (settings povero) ──────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const edgeSwipe = Gesture.Pan()
    .activeOffsetX(24)
    .hitSlop({ left: 0, width: 48 }) // solo dal bordo sinistro: niente conflitti con sources/scroll
    .onStart(() => setDrawerOpen(true));
  const drawerItems: DrawerItem[] = [
    {
      id: "privacy",
      label: "Privacy",
      Icon: LucideGlobe,
      onPress: () => {
        setDrawerOpen(false);
        showNotice("Tutto gira sul dispositivo. La web search invia solo la query al provider.");
      },
    },
    {
      id: "models",
      label: "Modelli",
      Icon: LucideGlobe,
      onPress: () => {
        setDrawerOpen(false);
        showNotice(`Modello attivo: ${currentModel.name} (${currentModel.quant}).`);
      },
    },
    {
      id: "about",
      label: "About",
      Icon: LucideGlobe,
      onPress: () => {
        setDrawerOpen(false);
        showNotice("AI Chat 0.1.0 — locale, privato, on-device.");
      },
    },
  ];

  // ── Notifiche locali (download) ──────────────────────────────────────────
  const notifyDownload = useCallback(async (title: string, body: string) => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        const requested = await Notifications.requestPermissionsAsync();
        if (!requested.granted) return;
      }
      await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
    } catch {
      // notifiche non disponibili: non bloccante
    }
  }, []);

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

  // Guard sincrone per download/switch (non soggette al batching di React).
  const downloadInFlight = useRef(false);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const engineGenerationRef = useRef(0);

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
    if (isEngineReady() && getActiveModelId() === model.id) return true;
    if (!(await isModelBundleDownloaded(model))) return false;
    const generation = engineGenerationRef.current;
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
      });
      if (generation !== engineGenerationRef.current) return false;
      setModelState("ready");
      return true;
    } catch (error) {
      if (generation !== engineGenerationRef.current) return false;
      setModelState("error");
      setModelError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  const selectModel = useCallback(
    (nextIndex: number) => {
      if (downloadInFlight.current || modelState === "downloading" || modelState === "loading") return;
      const wrapped = (nextIndex + MODEL_REGISTRY.length) % MODEL_REGISTRY.length;
      if (wrapped === modelIndex) return;
      void disposeEngine().then(() => {
        engineGenerationRef.current += 1;
        setModelIndex(wrapped);
        setModelState("checking");
        setModelError(null);
        // Persisti la selezione: riconoscimento al riavvio (come Atomic Chat).
        AsyncStorage.setItem(MODEL_STORAGE_KEY, MODEL_REGISTRY[wrapped].id).catch(() => undefined);
      });
    },
    [modelIndex, modelState],
  );

  const startDownload = useCallback(async () => {
    if (downloadInFlight.current || modelState === "downloading") return;
    downloadInFlight.current = true;
    const generation = engineGenerationRef.current;
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setModelState("downloading");
    setModelError(null);
    const bundleTotal = currentModel.sizeBytes + (currentModel.mmproj?.sizeBytes ?? 0);
    setDownload({ bytesReceived: 0, bytesTotal: bundleTotal, progress: 0 });
    try {
      const outcome = await downloadModelBundle(currentModel, {
        onBundleProgress: (progress) => {
          if (generation !== engineGenerationRef.current) return;
          setDownload({
            bytesReceived: Math.round(progress.overall * bundleTotal),
            bytesTotal: bundleTotal,
            progress: progress.overall,
          });
        },
        signal: controller.signal,
      });
      if (generation !== engineGenerationRef.current) return;
      if (outcome.model.status === "aborted" || outcome.mmproj?.status === "aborted") {
        setModelState("missing");
        return;
      }
      if (!(await isModelBundleDownloaded(currentModel))) {
        setModelState("error");
        setModelError("Download incomplete — tap to retry.");
        return;
      }
      setModelState("loading");
      const mmprojPath = currentModel.mmproj ? modelLocalPath(currentModel, currentModel.mmproj.file) : null;
      await initEngine(outcome.model.uri, currentModel.id, {
        mmprojPath,
        nCtx: currentModel.engineCtx,
        cacheTypeK: currentModel.kvCache.k,
        cacheTypeV: currentModel.kvCache.v,
        kvUnified: currentModel.kvUnified,
        mtpNMax: currentModel.mtp?.nMax,
      });
      if (generation !== engineGenerationRef.current) return;
      setModelState("ready");
      showNotice(`${currentModel.name} pronto.`);
      void notifyDownload("AI Chat", `${currentModel.name} scaricato e pronto.`);
    } catch (error) {
      if (generation !== engineGenerationRef.current) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
      setModelError(error instanceof Error ? error.message : String(error));
      void notifyDownload("AI Chat", `Download fallito: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      downloadInFlight.current = false;
      downloadAbortRef.current = null;
    }
  }, [currentModel, modelState, showNotice]);

  // Conferma esplicita prima del download (mai automatico).
  const confirmDownload = useCallback(() => {
    const total = currentModel.sizeBytes + (currentModel.mmproj?.sizeBytes ?? 0);
    Alert.alert(
      "Download model",
      `Scarica ${currentModel.name} (${formatBytes(total)})? Serve una connessione stabile e spazio su disco. Se si interrompe, riprende da dove era.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Download", onPress: () => void startDownload() },
      ],
    );
  }, [currentModel, startDownload]);

  // ── Chat wiring ──────────────────────────────────────────────────────────
  const handleMiniappAction = useCallback(
    (action: Record<string, unknown>, miniapp: AskAssistantMiniapp) => {
      void handleAskAssistantMiniappAction(action, miniapp, {
        setAskAssistantDraft: () => undefined,
        setFeedback: showNotice,
        setMobileError: (value) => showNotice(`⚠️ ${value}`),
      });
    },
    [showNotice],
  );

  const handleSendStream = useCallback(
    (text: string, callbacks: any, signal: AbortSignal, attachments?: LocalAttachment[], history?: unknown[]) =>
      new Promise<void>((resolve) => {
        const fail = (message: string) => {
          callbacks.onDelta?.(`⚠️ ${message}`, `⚠️ ${message}`);
          resolve();
        };
        void (async () => {
          try {
            if (!(await ensureEngineForModel(currentModel))) {
              fail(`Model not downloaded yet. Tap the model bar to download ${currentModel.name}.`);
              return;
            }
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
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
              onSources: (sources) => callbacks.onSources?.(mapExaSourcesToChat(sources as any)),
              onMiniapp: (miniapp) => callbacks.onMiniapp?.(miniapp),
              onTool: (tool) => callbacks.onActions?.({ kind: "tool", tool }),
              onDone: () => resolve(),
              onError: (error) => {
                callbacks.onDelta?.(`⚠️ ${error.message}`, `⚠️ ${error.message}`);
                resolve();
              },
            },
            signal,
            agentOptions,
          );
        })();
      }),
    [agentOptions, currentModel, ensureEngineForModel],
  );

  // ── Render barra modello ─────────────────────────────────────────────────
  const progressPercent = download ? Math.round(download.progress * 100) : 0;

  const modelBarStatus = (() => {
    const engineLoaded = isEngineReady() && getActiveModelId() === currentModel.id;
    switch (modelState) {
      case "checking":
        return { label: "Checking…", color: colors.muted };
      case "missing":
        return {
          label: `Download ${formatBytes(currentModel.sizeBytes + (currentModel.mmproj?.sizeBytes ?? 0))}`,
          color: colors.accent,
        };
      case "downloading":
        return { label: `Downloading… ${progressPercent}%`, color: colors.accent };
      case "loading":
        return { label: "Loading model…", color: colors.muted };
      case "error":
        return { label: "Download failed — tap to retry", color: colors.bad };
      case "ready":
        return { label: engineLoaded ? "Ready · local" : "Downloaded", color: engineLoaded ? colors.good : colors.muted };
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
              AI Chat
            </Text>
            {/* Tap: se serve il download → conferma; altrimenti cicla il modello */}
            <Pressable
              onPress={() =>
                modelState === "missing" || modelState === "error"
                  ? confirmDownload()
                  : selectModel(modelIndex + 1)
              }
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
            <Text style={[typography.monoXs, { color: colors.accent, fontWeight: "700" }]}>Web</Text>
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
            onOpenMiniapp={(miniapp) => setActiveMiniapp(miniapp as AskAssistantMiniapp)}
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
        brand="AI Chat"
        subtitle="Local · private"
        items={drawerItems}
      />

      {activeMiniapp ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setActiveMiniapp(null)}
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
                {activeMiniapp.title}
              </Text>
              <Pressable onPress={() => setActiveMiniapp(null)} hitSlop={8}>
                <LucideX size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <AskAssistantMiniappRenderer
                colors={colors}
                miniapp={activeMiniapp}
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
