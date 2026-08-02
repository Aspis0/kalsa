import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX } from "lucide-react-native";

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
import { streamAssistantTurn } from "../engine/LlamaService";

/**
 * AppShell — la schermata unica di AI Chat (Fase 0).
 *
 * Refactor del monolite originale (App.tsx, 3655 righe): qui restano solo
 * chat + Ask AI + viewer miniapp. L'engine locale (llama.rn) arriva in Fase 1
 * tramite `streamAssistantTurn`; oggi risponde con uno stub in streaming.
 */
export function AppShell() {
  const { colors, styles } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const [activeMiniapp, setActiveMiniapp] = useState<AskAssistantMiniapp | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistant = useAskAssistantController();

  const showNotice = useCallback((value: string) => {
    setNotice(value);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

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
    (text: string, callbacks: any, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        streamAssistantTurn(
          [{ role: "user", content: text }],
          {
            onDelta: callbacks.onDelta,
            onStatus: (status) => callbacks.onStatus?.(status),
            onSources: (sources) => callbacks.onSources?.(sources as any),
            onMiniapp: (miniapp) => callbacks.onMiniapp?.(miniapp),
            onTool: (tool) => callbacks.onActions?.({ kind: "tool", tool }),
            onDone: () => resolve(),
            onError: (error) => {
              callbacks.onDelta?.(`⚠️ ${error.message}`, `⚠️ ${error.message}`);
              resolve();
            },
          },
          signal,
        );
      }),
    [],
  );

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

        <View style={{ flex: 1 }}>
          <AiChatPage
            userName={null}
            selectedRun={null}
            prefillText={null}
            onSendStream={handleSendStream}
            onOpenMiniapp={(miniapp) => setActiveMiniapp(miniapp as AskAssistantMiniapp)}
            onCtaPress={(_cta: ChatCta) => undefined}
            getBioToken={async () => null}
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
