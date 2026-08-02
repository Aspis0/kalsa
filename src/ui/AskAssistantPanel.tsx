import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Animated, Easing, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import type {
  AskAssistantContext,
  AskAssistantMessage,
  AskAssistantMiniapp,
  AskAssistantQuickAction,
} from "../domain/askAssistant";
import { AskAssistantMiniappRenderer } from "./AskAssistantMiniappRenderer";

type GlassPanelComponent = React.ComponentType<{
  children: React.ReactNode;
  style?: object;
}>;

type GlassInputComponent = React.ComponentType<React.ComponentProps<typeof TextInput>>;

type AskAssistantPanelProps = {
  colors: {
    primaryText: string;
  };
  context: AskAssistantContext;
  draft: string;
  GlassInput: GlassInputComponent;
  GlassPanel: GlassPanelComponent;
  messages: AskAssistantMessage[];
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onMiniappAction: (action: Record<string, unknown>, miniapp: AskAssistantMiniapp) => void;
  onQuickAction: (action: AskAssistantQuickAction) => void;
  onSendDraft: () => void;
  styles: Record<string, any>;
};

export function AskAssistantPanel({
  colors,
  context,
  draft,
  GlassInput,
  GlassPanel,
  messages,
  onClose,
  onDraftChange,
  onMiniappAction,
  onQuickAction,
  onSendDraft,
  styles,
}: AskAssistantPanelProps) {
  const globeSpin = React.useRef(new Animated.Value(0)).current;
  const hasThinkingMessage = messages.some((message) => message.status === "thinking");
  const hasBusyMessage = messages.some((message) => message.status === "thinking" || message.status === "streaming");

  React.useEffect(() => {
    if (!hasThinkingMessage) {
      globeSpin.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.timing(globeSpin, {
        duration: 1200,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [globeSpin, hasThinkingMessage]);

  const globeRotation = globeSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View pointerEvents="box-none" style={styles.askAssistantSheet}>
      <GlassPanel style={[styles.askAssistantPanel, styles.askAssistantPanelChrome]}>
        <View style={styles.askAssistantHeader}>
          <View style={styles.askAssistantIcon}>
            <Ionicons name="sparkles-outline" color={colors.primaryText} size={20} />
          </View>
          <View style={styles.askAssistantHeaderCopy}>
            <Text style={styles.askAssistantTitle}>{context.title}</Text>
            <Text style={styles.askAssistantSubtitle}>{context.subtitle}</Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Close Ask AI"
            accessibilityRole="button"
            activeOpacity={0.84}
            onPress={onClose}
            style={styles.askAssistantCloseButton}
          >
            <Ionicons name="close" color={colors.primaryText} size={18} />
          </TouchableOpacity>
        </View>
        <View style={styles.askAssistantMessageStack}>
          <ScrollView accessibilityLabel="Conversation history" style={styles.askAssistantMessages} showsVerticalScrollIndicator={false}>
            {messages.map((message) => {
              const user = message.role === "user";
              const thinking = message.status === "thinking";
              const streaming = message.status === "streaming";
              return (
                <View
                  key={message.id}
                  accessibilityLabel={`${message.role} message: ${message.text}`}
                  accessibilityRole="text"
                  style={[
                    styles.askAssistantBubble,
                    user ? styles.askAssistantBubbleUser : styles.askAssistantBubbleAssistant,
                    thinking ? styles.askAssistantBubbleThinking : null,
                    streaming ? styles.askAssistantBubbleStreaming : null,
                  ]}
                >
                  {thinking ? (
                    <View style={styles.askAssistantThinkingRow}>
                      <Animated.View
                        accessibilityLabel="Aspis globe loading"
                        style={[
                          styles.askAssistantGlobeLoader,
                          {
                            transform: [{ rotate: globeRotation }],
                          },
                        ]}
                      >
                        <Animated.Image
                          source={require("../../assets/aspis-globe.png")}
                          style={styles.askAssistantGlobeImage}
                        />
                      </Animated.View>
                      <Text style={[styles.askAssistantBubbleText, styles.askAssistantThinkingText]}>
                        {message.text}
                      </Text>
                    </View>
                  ) : (
                    <Text style={user ? styles.askAssistantBubbleUserText : styles.askAssistantBubbleText}>
                      {message.text}
                    </Text>
                  )}
                  {!user && message.sources?.length ? (
                    <View style={styles.askAssistantSources}>
                      {message.sources.map((source) => (
                        <View key={source.id} style={styles.askAssistantSourceCard}>
                          <Text numberOfLines={1} style={styles.askAssistantSourceTitle}>
                            [{source.id}] {source.title || source.host || "Source"}
                          </Text>
                          {source.host ? (
                            <Text numberOfLines={1} style={styles.askAssistantSourceMeta}>
                              {source.host}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {!user && message.miniapp ? (
                    <AskAssistantMiniappRenderer
                      colors={colors}
                      miniapp={message.miniapp}
                      onAction={(action, currentMiniapp) => onMiniappAction(action, currentMiniapp as AskAssistantMiniapp)}
                      styles={styles}
                    />
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.askAssistantQuickRow}>
          {context.quickActions.map((action) => (
            <TouchableOpacity
              accessibilityLabel={action.label}
              accessibilityRole="button"
              activeOpacity={0.84}
              key={action.id}
              onPress={() => onQuickAction(action)}
              style={styles.askAssistantQuickAction}
            >
              <Text style={styles.askAssistantQuickText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[styles.askAssistantInputRow, styles.askAssistantComposer]}>
          <GlassInput
            blurOnSubmit={true}
            onChangeText={onDraftChange}
            onSubmitEditing={onSendDraft}
            placeholder="Ask follow-up"
            returnKeyType="send"
            style={[styles.askAssistantInput, styles.askAssistantInputPremium]}
            value={draft}
          />
          <TouchableOpacity
            accessibilityLabel="Send Ask AI message"
            accessibilityRole="button"
            accessibilityState={{ disabled: hasBusyMessage || !draft.trim() }}
            activeOpacity={0.84}
            disabled={hasBusyMessage || !draft.trim()}
            onPress={onSendDraft}
            style={[styles.askAssistantSendButton, (hasBusyMessage || !draft.trim()) ? { opacity: 0.42 } : null]}
          >
            <Ionicons name="send-outline" color={colors.primaryText} size={18} />
          </TouchableOpacity>
        </View>
      </GlassPanel>
    </View>
  );
}
