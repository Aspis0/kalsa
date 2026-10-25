/**
 * Read aloud / stop reading — the controller's `handleReadAloud`
 * (`AiChatPage.tsx:1613-1660`), its `speakingId` state (`Chat:934`) and the
 * two cleanup halves it owned: a conversation change stops the voice and
 * clears the chip (`Chat:1903-1905`), unmount stops it (`Chat:1419`).
 *
 * Built because the TTS service can be called on its own: `src/voice/
 * TtsService.ts` imports only AsyncStorage, expo-speech and the i18n `Locale`
 * type — no `src/engine/**`, no governor (checked by `readAloud.test.ts`).
 *
 * The preference gate is the controller's own: with TTS off the chip still
 * answers, with the shipped line that says where to turn it on
 * (`voice.ttsDisabled`) — a disabled preference explaining itself, not a
 * button that cannot work.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale, TranslationKey } from "../i18n";
import * as TtsService from "../voice/TtsService";

export interface ReadAloudParams {
  locale: Locale;
  /** A switch stops the voice: an answer must not read into the next chat. */
  conversationId: string | undefined;
  /** The scan's persisted TTS preference (`usePipelineScans`). */
  ttsEnabled: boolean;
  showNoticeKey: (key: TranslationKey) => void;
  /** The chip is not a menu row, but the controller closed the menu first. */
  closeMenu: () => void;
}

export interface ReadAloud {
  /** The id whose chip reads "Stop reading", or null. */
  speakingId: string | null;
  /** Toggle: speak this message, or stop it if it is the one speaking. */
  speak: (id: string, text: string) => void;
}

export function useReadAloud(params: ReadAloudParams): ReadAloud {
  const { locale, conversationId, ttsEnabled, showNoticeKey, closeMenu } = params;
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // TTS callbacks fire after unmount (nav away mid-speech) — guarded like the
  // controller's own callbacks (its M8 finding).
  const mountedRef = useRef(true);
  const speakingRef = useRef<string | null>(null);
  speakingRef.current = speakingId;
  const latest = useRef(params);
  latest.current = params;

  const speak = useCallback(async (id: string, text: string) => {
    const p = latest.current;
    p.closeMenu();
    if (!p.ttsEnabled) {
      p.showNoticeKey("voice.ttsDisabled");
      return;
    }
    const cleaned = text.trim();
    if (!cleaned) return;
    try {
      if (speakingRef.current === id && (await TtsService.isSpeaking())) {
        await TtsService.stop();
        if (!mountedRef.current) return;
        setSpeakingId(null);
        return;
      }
      await TtsService.stop();
      if (!mountedRef.current) return;
      setSpeakingId(id);
      TtsService.speak(cleaned, p.locale, {
        onDone: () => {
          if (!mountedRef.current) return;
          setSpeakingId((current) => (current === id ? null : current));
        },
        onStopped: () => {
          if (!mountedRef.current) return;
          setSpeakingId((current) => (current === id ? null : current));
        },
        onError: () => {
          if (!mountedRef.current) return;
          setSpeakingId((current) => (current === id ? null : current));
          p.showNoticeKey("voice.ttsError");
        },
      });
    } catch {
      if (!mountedRef.current) return;
      setSpeakingId(null);
      p.showNoticeKey("voice.ttsError");
    }
  }, []);

  // Unmount: stop the voice (controller `Chat:1412-1426`, TTS half) and mark
  // the component dead for the callbacks above.
  useEffect(
    () => () => {
      mountedRef.current = false;
      void TtsService.stop();
    },
    [],
  );

  // Conversation change: stop mid-speech and clear the chip (the
  // controller's `Chat:1903-1905` inside its abort effect).
  const lastConversationRef = useRef(conversationId);
  useEffect(() => {
    const previous = lastConversationRef.current;
    lastConversationRef.current = conversationId;
    if (previous === conversationId) return;
    void TtsService.stop();
    setSpeakingId(null);
  }, [conversationId]);

  return { speakingId, speak };
}
