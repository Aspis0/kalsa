import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX, Check as LucideCheck, Globe as LucideGlobe } from "lucide-react-native";

import { AiChatPage, type ChatCta } from "../screens/AiChatPage";
import { AskAssistantPanel } from "../ui/AskAssistantPanel";
import { AskAssistantMiniappRenderer } from "../ui/AskAssistantMiniappRenderer";
import { GlassInput, GlassPanel } from "../ui/GlassPrimitives";
import { AskAIChip, PainterlyBg } from "../theme/components";
import { spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import { useAskAssistantController } from "./askAssistantController";
import { handleAskAssistantMiniappAction } from "./miniappActions";
import { MODEL_REGISTRY, getDefaultModel, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { downloadModel, isModelDownloaded, modelLocalPath, type DownloadProgress } from "../engine/ModelDownloader";
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

  // ── Websearch (Fase 2) ───────────────────────────────────────────────────
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const agentOptions = useMemo<EngineTurnOptions | undefined>(
    () =>
      webSearchEnabled
        ? { tools: [WEB_SEARCH_TOOL], executeTool: makeWebSearchExecutor() }
        : undefined,
    [webSearchEnabled],
  );

  const assistant = useAskAssistantController(agentOptions);

  // ── Stato modello ────────────────────────────────────────────────────────
  const [modelIndex, setModelIndex] = useState(() =>
    Math.max(0, MODEL_REGISTRY.findIndex((m) => m.id === getDefaultModel().id)),
  );
  const [modelState, setModelState] = useState<ModelState>("checking");
  const [download, setDownload] = useState<DownloadProgress | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const currentModel = MODEL_REGISTRY[modelIndex];

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

  // Controllo iniziale: il modello default è già scaricato?
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const ok = await isModelDownloaded(currentModel);
        if (mounted) setModelState(ok ? "ready" : "missing");
      } catch {
        if (mounted) setModelState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIndex]);

  const ensureEngineForModel = useCallback(async (model: ModelInfo): Promise<boolean> => {
    if (isEngineReady() && getActiveModelId() === model.id) return true;
    if (!(await isModelDownloaded(model))) return false;
    const generation = engineGenerationRef.current;
    setModelState("loading");
    try {
      await initEngine(modelLocalPath(model), model.id);
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
    setDownload({ bytesReceived: 0, bytesTotal: currentModel.sizeBytes, progress: 0 });
    try {
      const outcome = await downloadModel(currentModel, {
        onProgress: (progress) => {
          if (generation !== engineGenerationRef.current) return;
          setDownload(progress);
        },
        signal: controller.signal,
      });
      if (generation !== engineGenerationRef.current) return;
      if (outcome.status === "aborted") {
        setModelState("missing");
        return;
      }
      if (!(await isModelDownloaded(currentModel))) {
        setModelState("error");
        setModelError("Download incomplete — tap to retry.");
        return;
      }
      setModelState("loading");
      await initEngine(outcome.uri, currentModel.id);
      if (generation !== engineGenerationRef.current) return;
      setModelState("ready");
      showNotice(`${currentModel.name} pronto.`);
    } catch (error) {
      if (generation !== engineGenerationRef.current) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      downloadInFlight.current = false;
      downloadAbortRef.current = null;
    }
  }, [currentModel, modelState, showNotice]);

  // ── Chat wiring ──────────────────────────────────────────────────────────
  const handleMiniappAction = useCallback(
    (action: Record<string, unknown>, miniapp: AskAssistantMiniapp) => {
      void handleAskAssistantMiniappAction(action, miniapp, {
        setAskAssistantDraft: assistant.setDraft,
        setFeedback: showNotice,
        setMobileError: (value) => showNotice(`⚠️ ${value}`),
      });
    },
    [assistant.setDraft, showNotice],
  );

  const handleSendStream = useCallback(
    (text: string, callbacks: any, signal: AbortSignal, _attachments?: unknown, history?: unknown[]) =>
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
          // Memoria conversazionale: passa gli ultimi N messaggi (validati e
          // limitati), NON solo l'ultimo turno.
          const engineMessages: EngineMessage[] = (history ?? [])
            .filter(
              (m) =>
                m &&
                typeof m === "object" &&
                typeof (m as { text?: unknown }).text === "string" &&
                ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant"),
            )
            .slice(-20)
            .map((m) => ({
              role: (m as { role: string }).role as "user" | "assistant",
              content: ((m as { text: string }).text as string).slice(0, 4000),
            }));
          engineMessages.push({ role: "user", content: text });

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
        return { label: `Download ${formatBytes(currentModel.sizeBytes)}`, color: colors.accent };
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
      {/* AiChatPage gestisce già le proprie safe-area (nav top + composer bottom). */}
      <SafeAreaView style={{ flex: 1 }} edges={[]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[typography.bodyLg, { color: colors.ink, fontWeight: "700", letterSpacing: 0.3 }]}>
              AI Chat
            </Text>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>Local · private · on-device</Text>
          </View>
          <AskAIChip onPress={assistant.toggleOpen} label={assistant.open ? "Close" : "Ask AI"} />
        </View>

        {/* Barra modello */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            paddingHorizontal: spacing.sm,
            paddingVertical: 6,
            borderRadius: 12,
            backgroundColor: colors.panelSoft,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Pressable
            onPress={() => selectModel(modelIndex + 1)}
            hitSlop={6}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}
          >
            <Text style={[typography.bodyXs, { color: colors.ink, fontWeight: "700" }]} numberOfLines={1}>
              {currentModel.name}
            </Text>
            <Text style={[typography.monoXs, { color: colors.muted }]}>
              {currentModel.quant} · {currentModel.vendor}
            </Text>
          </Pressable>

          <View style={{ flex: 1 }} />

          {/* Toggle websearch: privacy by design — OFF = tutto locale */}
          <Pressable
            onPress={() => setWebSearchEnabled((enabled) => !enabled)}
            hitSlop={6}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: webSearchEnabled ? `${colors.accent}22` : "transparent",
              borderWidth: 1,
              borderColor: webSearchEnabled ? `${colors.accent}55` : colors.line,
            }}
          >
            <LucideGlobe size={12} color={webSearchEnabled ? colors.accent : colors.muted} />
            <Text
              style={[
                typography.monoXs,
                { color: webSearchEnabled ? colors.accent : colors.muted, fontWeight: "700" },
              ]}
            >
              {webSearchEnabled ? "Web ON" : "Web OFF"}
            </Text>
          </Pressable>

          {modelState === "missing" || modelState === "error" ? (
            <Pressable onPress={() => void startDownload()} hitSlop={6}>
              <Text style={[typography.bodyXs, { color: modelBarStatus.color, fontWeight: "700" }]}>
                {modelState === "error" ? "Retry download" : modelBarStatus.label}
              </Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {modelState === "downloading" ? (
                <View
                  style={{
                    height: 4,
                    width: 64,
                    borderRadius: 2,
                    backgroundColor: colors.line,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 4,
                      width: `${progressPercent}%`,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
              ) : null}
              {modelState === "ready" ? <LucideCheck size={14} color={colors.good} /> : null}
              <Text style={[typography.bodyXs, { color: modelBarStatus.color }]} numberOfLines={1}>
                {modelBarStatus.label}
              </Text>
            </View>
          )}
        </View>

        {webSearchEnabled ? (
          <Text
            style={[
              typography.bodyXs,
              { color: colors.muted, marginHorizontal: spacing.lg, marginBottom: spacing.xs },
            ]}
          >
            Websearch on: queries go to the search provider only when the model uses the tool.
          </Text>
        ) : null}

        {modelError ? (
          <Text
            style={[
              typography.bodyXs,
              { color: colors.bad, marginHorizontal: spacing.lg, marginBottom: spacing.xs },
            ]}
            numberOfLines={2}
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

        {assistant.open ? (
          <AskAssistantPanel
            colors={colors}
            context={assistant.context}
            draft={assistant.draft}
            GlassInput={GlassInput}
            GlassPanel={GlassPanel}
            messages={assistant.messages}
            onClose={assistant.close}
            onDraftChange={assistant.setDraft}
            onMiniappAction={handleMiniappAction}
            onQuickAction={assistant.runQuickAction}
            onSendDraft={assistant.sendDraft}
            styles={styles}
          />
        ) : null}
      </SafeAreaView>

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
